const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient } = require('mongodb');
const { google } = require('googleapis');
const tar = require('tar');

const requiredEnv = ['MONGO_URI', 'GDRIVE_FOLDER_ID'];

const ensureEnv = () => {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  const hasOauth = Boolean(
    process.env.GDRIVE_OAUTH_CLIENT_ID &&
    process.env.GDRIVE_OAUTH_CLIENT_SECRET &&
    process.env.GDRIVE_OAUTH_REFRESH_TOKEN
  );
  const hasServiceAccount = Boolean(process.env.GDRIVE_SERVICE_ACCOUNT_JSON);
  if (!hasOauth && !hasServiceAccount) {
    throw new Error('Missing Google Drive credentials. Set OAuth secrets or GDRIVE_SERVICE_ACCOUNT_JSON.');
  }
};

const getDriveAuth = () => {
  const oauthClientId = process.env.GDRIVE_OAUTH_CLIENT_ID || '';
  const oauthClientSecret = process.env.GDRIVE_OAUTH_CLIENT_SECRET || '';
  const oauthRefreshToken = process.env.GDRIVE_OAUTH_REFRESH_TOKEN || '';

  if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
    const oauth = new google.auth.OAuth2(oauthClientId, oauthClientSecret);
    oauth.setCredentials({ refresh_token: oauthRefreshToken });
    return oauth;
  }

  const raw = process.env.GDRIVE_SERVICE_ACCOUNT_JSON || '';
  const trimmed = raw.trim();
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
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
  } catch (err) {
    throw new Error('Failed to parse Google Drive credentials.');
  }
};

const formatTimestamp = () => {
  const timeZone = process.env.BACKUP_TZ || 'UTC';
  const now = new Date();
  const dateStamp = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const timeStamp = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now).replace(/:/g, '');
  return `${dateStamp}-${timeStamp}`;
};

const toExtendedJson = (value) => {
  if (value === null || value === undefined) return value;

  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }

  if (Buffer.isBuffer(value)) {
    return { $binary: { base64: value.toString('base64'), subType: '00' } };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toExtendedJson(entry));
  }

  if (typeof value === 'object') {
    if (value._bsontype) {
      switch (value._bsontype) {
        case 'ObjectId':
          return { $oid: value.toString() };
        case 'Decimal128':
          return { $numberDecimal: value.toString() };
        case 'Long':
          return { $numberLong: value.toString() };
        case 'Int32':
          return { $numberInt: value.toString() };
        case 'Double':
          return { $numberDouble: value.toString() };
        case 'Binary': {
          const base64 = value.buffer ? value.buffer.toString('base64') : Buffer.from(value.value()).toString('base64');
          const subType = value.sub_type ?? value.subType ?? 0;
          return { $binary: { base64, subType: subType.toString(16).padStart(2, '0') } };
        }
        case 'Timestamp': {
          const t = typeof value.getHighBits === 'function' ? value.getHighBits() : value.t ?? 0;
          const i = typeof value.getLowBits === 'function' ? value.getLowBits() : value.i ?? 0;
          return { $timestamp: { t, i } };
        }
        case 'MinKey':
          return { $minKey: 1 };
        case 'MaxKey':
          return { $maxKey: 1 };
        case 'RegExp':
          return { $regularExpression: { pattern: value.pattern, options: value.options || '' } };
        default:
          return String(value);
      }
    }

    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = toExtendedJson(entry);
    }
    return output;
  }

  return value;
};

const stringifyDoc = (doc) => JSON.stringify(toExtendedJson(doc));

const exportCollections = async (db, outputDir) => {
  const collections = await db.collections();
  const summary = [];

  for (const collection of collections) {
    const name = collection.collectionName;
    const filePath = path.join(outputDir, `${name}.jsonl`);
    const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
    let count = 0;

    const cursor = collection.find({});
    for await (const doc of cursor) {
      try {
        stream.write(`${stringifyDoc(doc)}\n`);
        count += 1;
      } catch (err) {
        console.warn(`[backup] Skipping document in ${name}:`, err.message);
      }
    }

    await new Promise((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });

    summary.push({ name, count });
  }

  return summary;
};

const uploadToDrive = async (archivePath, folderId) => {
  const auth = getDriveAuth();
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.create({
    requestBody: {
      name: path.basename(archivePath),
      parents: [folderId],
    },
    media: {
      mimeType: 'application/gzip',
      body: fs.createReadStream(archivePath),
    },
    fields: 'id,name,size',
  });

  return response.data;
};

const main = async () => {
  ensureEnv();

  const prefix = process.env.BACKUP_PREFIX || 'lte-backup';
  const timestamp = formatTimestamp();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const archivePath = path.join(os.tmpdir(), `${prefix}-${timestamp}.tgz`);
  const mongoUri = process.env.MONGO_URI;
  const folderId = process.env.GDRIVE_FOLDER_ID;

  const client = new MongoClient(mongoUri, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 20000,
  });

  try {
    await client.connect();
    const db = client.db();
    const collections = await exportCollections(db, tempDir);
    const meta = {
      database: db.databaseName,
      generatedAt: new Date().toISOString(),
      collections,
    };
    fs.writeFileSync(path.join(tempDir, 'metadata.json'), JSON.stringify(meta, null, 2));

    await tar.c(
      { gzip: true, file: archivePath, cwd: tempDir },
      ['.']
    );

    const upload = await uploadToDrive(archivePath, folderId);
    console.log('Backup uploaded:', upload);
  } finally {
    await client.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(archivePath, { force: true });
  }
};

main().catch((err) => {
  console.error('[backup]', err);
  process.exit(1);
});
