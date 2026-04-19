const fs = require('fs');
const { MongoClient } = require('mongodb');

const { fromExtendedJson } = require('./restoreFromBackup');

const readEnv = (key) => String(process.env[key] || '').trim();

const ensureEnv = () => {
  const missing = ['MONGO_URI', 'FULL_EXPORT_FILE'].filter((key) => !readEnv(key));
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
};

const loadPayload = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const payload = JSON.parse(raw);

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.collections)) {
    throw new Error('Invalid recovery export format.');
  }

  return payload;
};

const importCollection = async (db, collection, dropExisting, batchSize) => {
  const target = db.collection(collection.name);
  if (dropExisting) {
    await target.deleteMany({});
  }

  const documents = Array.isArray(collection.documents) ? collection.documents.map(fromExtendedJson) : [];
  if (!documents.length) return 0;

  let imported = 0;
  for (let index = 0; index < documents.length; index += batchSize) {
    const batch = documents.slice(index, index + batchSize);
    await target.insertMany(batch, { ordered: false });
    imported += batch.length;
  }

  return imported;
};

const main = async () => {
  ensureEnv();

  const payload = loadPayload(readEnv('FULL_EXPORT_FILE'));
  const dropExisting = readEnv('IMPORT_DROP_EXISTING') === 'true';
  const batchSize = Number(readEnv('IMPORT_BATCH_SIZE') || 500);
  const targetDatabase = readEnv('IMPORT_DATABASE');
  const client = new MongoClient(readEnv('MONGO_URI'), {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 20000,
  });

  try {
    await client.connect();
    const db = targetDatabase ? client.db(targetDatabase) : client.db();

    for (const collection of payload.collections) {
      const imported = await importCollection(db, collection, dropExisting, batchSize);
      console.log(`[import] ${collection.name}: ${imported}`);
    }
  } finally {
    await client.close().catch(() => {});
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error('[import-full-recovery-export]', error);
    process.exit(1);
  });
}

module.exports = {
  loadPayload,
  importCollection,
};
