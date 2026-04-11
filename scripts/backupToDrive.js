const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');
const { google } = require('googleapis');
const tar = require('tar');

const requiredEnv = ['MONGO_URI', 'GDRIVE_FOLDER_ID', 'GDRIVE_SERVICE_ACCOUNT_JSON'];

const ensureEnv = () => {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
};

const parseServiceAccount = () => {
  const raw = process.env.GDRIVE_SERVICE_ACCOUNT_JSON || '';
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('GDRIVE_SERVICE_ACCOUNT_JSON is empty');
  }
  try {
    const json = trimmed.startsWith('{')
      ? trimmed
      : Buffer.from(trimmed, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    throw new Error('Failed to parse GDRIVE_SERVICE_ACCOUNT_JSON');
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
      stream.write(`${EJSON.stringify(doc)}\n`);
      count += 1;
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
  const credentials = parseServiceAccount();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
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
