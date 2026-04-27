const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const readEnv = (key) => String(process.env[key] || '').trim();

const isInvalidGoogleGrant = (err) =>
  err?.response?.data?.error === 'invalid_grant' ||
  err?.code === 'invalid_grant' ||
  err?.message?.includes('invalid_grant');

const getDriveAuthFailureMessage = (err) => {
  if (!isInvalidGoogleGrant(err)) return '';
  return [
    'Google Drive OAuth refresh token is expired or revoked.',
    'Update the GitHub secret GDRIVE_OAUTH_REFRESH_TOKEN with a newly generated refresh token,',
    'or switch the workflow to GDRIVE_SERVICE_ACCOUNT_JSON and share the Drive folder with that service account.',
    'The restore-from-Drive check could not download a backup archive.',
  ].join(' ');
};

const ensureEnv = () => {
  const missing = ['GDRIVE_FOLDER_ID', 'BACKUP_DOWNLOAD_DIR'].filter((key) => !readEnv(key));
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }

  const hasOauth = Boolean(
    readEnv('GDRIVE_OAUTH_CLIENT_ID') &&
    readEnv('GDRIVE_OAUTH_CLIENT_SECRET') &&
    readEnv('GDRIVE_OAUTH_REFRESH_TOKEN')
  );
  const hasServiceAccount = Boolean(readEnv('GDRIVE_SERVICE_ACCOUNT_JSON'));

  if (!hasOauth && !hasServiceAccount) {
    throw new Error('Missing Google Drive credentials. Set OAuth secrets or GDRIVE_SERVICE_ACCOUNT_JSON.');
  }
};

const getDriveAuth = () => {
  const oauthClientId = readEnv('GDRIVE_OAUTH_CLIENT_ID');
  const oauthClientSecret = readEnv('GDRIVE_OAUTH_CLIENT_SECRET');
  const oauthRefreshToken = readEnv('GDRIVE_OAUTH_REFRESH_TOKEN');

  if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
    const oauth = new google.auth.OAuth2(oauthClientId, oauthClientSecret);
    oauth.setCredentials({ refresh_token: oauthRefreshToken });
    return oauth;
  }

  const trimmed = readEnv('GDRIVE_SERVICE_ACCOUNT_JSON');
  if (!trimmed) {
    throw new Error('Provide OAuth credentials or GDRIVE_SERVICE_ACCOUNT_JSON.');
  }

  try {
    const json = trimmed.startsWith('{')
      ? trimmed
      : Buffer.from(trimmed, 'base64').toString('utf8');
    const credentials = JSON.parse(json);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
  } catch (err) {
    throw new Error('Failed to parse Google Drive credentials.');
  }
};

const escapeDriveQueryValue = (value) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const pickBackupFile = async (drive, folderId, filename, prefix) => {
  const terms = [
    `'${folderId}' in parents`,
    'trashed=false',
    "mimeType!='application/vnd.google-apps.folder'",
  ];

  if (filename) {
    terms.push(`name='${escapeDriveQueryValue(filename)}'`);
  } else {
    const normalizedPrefix = prefix || 'lte-backup';
    terms.push(`name contains '${escapeDriveQueryValue(normalizedPrefix)}'`);
  }

  const response = await drive.files.list({
    q: terms.join(' and '),
    fields: 'files(id,name,size,modifiedTime)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'modifiedTime desc',
    pageSize: 100,
  });

  const candidates = (response.data.files || []).filter((file) => /\.tgz(\.enc)?$/i.test(file.name));

  if (filename) {
    return candidates.find((file) => file.name === filename) || null;
  }

  return candidates[0] || null;
};

const downloadFile = async (drive, file, outputDir) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, file.name);
  const dest = fs.createWriteStream(outputPath);

  const response = await drive.files.get(
    {
      fileId: file.id,
      alt: 'media',
      supportsAllDrives: true,
    },
    { responseType: 'stream' }
  );

  await new Promise((resolve, reject) => {
    response.data
      .on('error', reject)
      .pipe(dest)
      .on('error', reject)
      .on('finish', resolve);
  });

  return outputPath;
};

const main = async () => {
  ensureEnv();

  const auth = getDriveAuth();
  const drive = google.drive({ version: 'v3', auth });
  const folderId = readEnv('GDRIVE_FOLDER_ID');
  const outputDir = readEnv('BACKUP_DOWNLOAD_DIR');
  const filename = readEnv('BACKUP_FILENAME');
  const prefix = readEnv('BACKUP_PREFIX');

  let file;
  try {
    file = await pickBackupFile(drive, folderId, filename, prefix);
  } catch (err) {
    const authFailureMessage = getDriveAuthFailureMessage(err);
    if (authFailureMessage) {
      throw new Error(authFailureMessage);
    }
    throw err;
  }

  if (!file) {
    const descriptor = filename ? `named ${filename}` : `with prefix ${prefix || 'lte-backup'}`;
    throw new Error(`No backup archive found in Drive folder ${descriptor}.`);
  }

  const outputPath = await downloadFile(drive, file, outputDir);

  console.log(`BACKUP_FILE_NAME=${file.name}`);
  console.log(`BACKUP_FILE_ID=${file.id}`);
  console.log(`BACKUP_FILE_SIZE=${file.size || ''}`);
  console.log(`BACKUP_FILE_MODIFIED=${file.modifiedTime || ''}`);
  console.log(`BACKUP_ARCHIVE_PATH=${outputPath}`);
};

if (require.main === module) {
  main().catch((err) => {
    console.error('[download-backup]', err);
    process.exit(1);
  });
}

module.exports = {
  ensureEnv,
  getDriveAuthFailureMessage,
  pickBackupFile,
};
