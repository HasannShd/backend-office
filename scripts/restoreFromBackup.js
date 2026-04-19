const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const tar = require('tar');
const {
  MongoClient,
  ObjectId,
  Decimal128,
  Long,
  Int32,
  Double,
  Binary,
  Timestamp,
  MinKey,
  MaxKey,
  BSONRegExp,
} = require('mongodb');

const requiredEnv = ['MONGO_URI', 'BACKUP_ARCHIVE'];
const readEnv = (key) => String(process.env[key] || '').trim();

const ensureEnv = () => {
  const missing = requiredEnv.filter((key) => !readEnv(key));
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
  if (readEnv('BACKUP_ARCHIVE').endsWith('.enc') && !readEnv('BACKUP_ENCRYPTION_KEY')) {
    throw new Error('Missing required env: BACKUP_ENCRYPTION_KEY for encrypted backup restore.');
  }
};

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object') return false;
  return Object.getPrototypeOf(value) === Object.prototype;
};

const fromExtendedJson = (value) => {
  if (Array.isArray(value)) {
    return value.map(fromExtendedJson);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const keys = Object.keys(value);

  if (keys.length === 1) {
    if (value.$oid) return new ObjectId(value.$oid);
    if (value.$date) return new Date(value.$date);
    if (value.$numberLong) return Long.fromString(value.$numberLong);
    if (value.$numberInt) return new Int32(parseInt(value.$numberInt, 10));
    if (value.$numberDouble) return new Double(Number(value.$numberDouble));
    if (value.$numberDecimal) return Decimal128.fromString(value.$numberDecimal);
    if (value.$minKey) return new MinKey();
    if (value.$maxKey) return new MaxKey();
    if (value.$binary) {
      const base64 = value.$binary.base64 || '';
      const subtype = value.$binary.subType || '00';
      return new Binary(Buffer.from(base64, 'base64'), parseInt(subtype, 16));
    }
    if (value.$timestamp) {
      const t = value.$timestamp.t || 0;
      const i = value.$timestamp.i || 0;
      return new Timestamp({ t, i });
    }
    if (value.$regularExpression) {
      const pattern = value.$regularExpression.pattern || '';
      const options = value.$regularExpression.options || '';
      return new BSONRegExp(pattern, options);
    }
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = fromExtendedJson(entry);
  }
  return output;
};

const parseJsonLine = (line) => fromExtendedJson(JSON.parse(line));
const getEncryptionKey = () =>
  crypto.createHash('sha256').update(readEnv('BACKUP_ENCRYPTION_KEY')).digest();

const decryptArchive = async (sourcePath, targetPath) => {
  const stat = fs.statSync(sourcePath);
  if (stat.size <= 28) throw new Error('Encrypted archive is too small to decrypt.');
  const fileHandle = fs.openSync(sourcePath, 'r');
  const iv = Buffer.alloc(12);
  const authTag = Buffer.alloc(16);
  fs.readSync(fileHandle, iv, 0, 12, 0);
  fs.readSync(fileHandle, authTag, 0, 16, stat.size - 16);
  fs.closeSync(fileHandle);

  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  const input = fs.createReadStream(sourcePath, { start: 12, end: stat.size - 17 });
  const output = fs.createWriteStream(targetPath);
  await new Promise((resolve, reject) => {
    input.on('error', reject);
    output.on('error', reject);
    decipher.on('error', (err) => reject(new Error(`Failed to decrypt backup archive: ${err.message}`)));
    output.on('finish', resolve);
    input.pipe(decipher).pipe(output);
  });
};

const listCollections = (dir) => {
  const metaPath = path.join(dir, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (Array.isArray(meta.collections)) {
        return meta.collections.map((item) => item.name).filter(Boolean);
      }
    } catch (err) {
      console.warn('[restore] Failed to parse metadata.json, falling back to file scan.');
    }
  }

  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.replace(/\.jsonl$/, ''));
};

const restoreCollection = async (db, name, filePath, batchSize, dropExisting) => {
  if (dropExisting) {
    await db.collection(name).deleteMany({});
  }

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch = [];
  let count = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const doc = parseJsonLine(line);
    batch.push(doc);
    if (batch.length >= batchSize) {
      await db.collection(name).insertMany(batch, { ordered: false });
      count += batch.length;
      batch = [];
    }
  }

  if (batch.length) {
    await db.collection(name).insertMany(batch, { ordered: false });
    count += batch.length;
  }

  return count;
};

const extractArchive = async (archivePath) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lte-restore-'));
  const archiveToExtract = archivePath.endsWith('.enc')
    ? path.join(tempDir, 'backup.tgz')
    : archivePath;

  if (archivePath.endsWith('.enc')) {
    await decryptArchive(archivePath, archiveToExtract);
  }

  await tar.x({ file: archiveToExtract, cwd: tempDir });

  return {
    tempDir,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
};

const verifyArchive = async (archivePath) => {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Backup archive not found: ${archivePath}`);
  }

  const { tempDir, cleanup } = await extractArchive(archivePath);

  try {
    const collections = listCollections(tempDir);
    if (!collections.length) {
      throw new Error('Backup archive does not contain any collections.');
    }

    const verification = [];

    for (const name of collections) {
      const filePath = path.join(tempDir, `${name}.jsonl`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Missing collection export: ${name}.jsonl`);
      }

      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let count = 0;

      for await (const line of rl) {
        if (!line.trim()) continue;
        parseJsonLine(line);
        count += 1;
      }

      verification.push({ name, count });
    }

    return verification;
  } finally {
    cleanup();
  }
};

const main = async () => {
  ensureEnv();

  const archivePath = readEnv('BACKUP_ARCHIVE');
  const dropExisting = readEnv('RESTORE_DROP_EXISTING') === 'true';
  const batchSize = Number(readEnv('RESTORE_BATCH_SIZE') || 1000);
  const verifyOnly = readEnv('RESTORE_VERIFY_ONLY') === 'true';

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Backup archive not found: ${archivePath}`);
  }

  if (verifyOnly) {
    const collections = await verifyArchive(archivePath);
    collections.forEach(({ name, count }) => {
      console.log(`[verify] ${name}: ${count}`);
    });
    return;
  }

  const { tempDir, cleanup } = await extractArchive(archivePath);

  const client = new MongoClient(readEnv('MONGO_URI'), {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 20000,
  });

  try {
    await client.connect();
    const db = client.db();
    const collections = listCollections(tempDir);
    for (const name of collections) {
      const filePath = path.join(tempDir, `${name}.jsonl`);
      if (!fs.existsSync(filePath)) continue;
      const restored = await restoreCollection(db, name, filePath, batchSize, dropExisting);
      console.log(`[restore] ${name}: ${restored}`);
    }
  } finally {
    await client.close().catch(() => {});
    cleanup();
  }
};

if (require.main === module) {
  main().catch((err) => {
    console.error('[restore]', err);
    process.exit(1);
  });
}

module.exports = {
  ensureEnv,
  fromExtendedJson,
  parseJsonLine,
  listCollections,
  verifyArchive,
  readEnv,
};
