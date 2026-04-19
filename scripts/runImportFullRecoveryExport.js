const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);

const readFlagValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return '';
  return args[index + 1] || '';
};

const hasFlag = (flag) => args.includes(flag);

const filePath = readFlagValue('--file');
const mongoUri = readFlagValue('--mongo-uri') || process.env.MONGO_URI || '';
const batchSize = readFlagValue('--batch-size') || process.env.IMPORT_BATCH_SIZE || '';
const database = readFlagValue('--database') || process.env.IMPORT_DATABASE || '';
const dropExisting = hasFlag('--drop-existing');

if (!filePath) {
  console.error('Usage: npm run import:full-export -- --file /path/to/lte-full-recovery-export.json [--drop-existing] [--mongo-uri ...] [--database ...] [--batch-size ...]');
  process.exit(1);
}

if (!mongoUri) {
  console.error('Missing MongoDB connection. Set MONGO_URI in .env or pass --mongo-uri.');
  process.exit(1);
}

const env = {
  ...process.env,
  MONGO_URI: mongoUri,
  FULL_EXPORT_FILE: filePath,
};

if (batchSize) {
  env.IMPORT_BATCH_SIZE = batchSize;
}

if (database) {
  env.IMPORT_DATABASE = database;
}

if (dropExisting) {
  env.IMPORT_DROP_EXISTING = 'true';
}

const child = spawn(process.execPath, [path.join(__dirname, 'importFullRecoveryExport.js')], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
