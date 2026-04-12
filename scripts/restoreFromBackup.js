const fs = require('fs');
const os = require('os');
const path = require('path');
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

const ensureEnv = () => {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
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

const main = async () => {
  ensureEnv();

  const archivePath = process.env.BACKUP_ARCHIVE;
  const dropExisting = String(process.env.RESTORE_DROP_EXISTING || 'false') === 'true';
  const batchSize = Number(process.env.RESTORE_BATCH_SIZE || 1000);

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Backup archive not found: ${archivePath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lte-restore-'));
  await tar.x({ file: archivePath, cwd: tempDir });

  const client = new MongoClient(process.env.MONGO_URI, {
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
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((err) => {
  console.error('[restore]', err);
  process.exit(1);
});
