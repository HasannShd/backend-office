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

const archivePath = readFlagValue('--archive');
const mongoUri = readFlagValue('--mongo-uri') || process.env.MONGO_URI || '';
const encryptionKey = readFlagValue('--encryption-key') || process.env.BACKUP_ENCRYPTION_KEY || '';
const batchSize = readFlagValue('--batch-size') || process.env.RESTORE_BATCH_SIZE || '';
const verifyOnly = hasFlag('--verify');
const dropExisting = hasFlag('--drop-existing');

if (!archivePath) {
  console.error('Usage: npm run restore:file -- --archive /path/to/backup.tgz[.enc] [--verify] [--drop-existing] [--mongo-uri ...] [--encryption-key ...]');
  process.exit(1);
}

if (!mongoUri) {
  console.error('Missing MongoDB connection. Set MONGO_URI in .env or pass --mongo-uri.');
  process.exit(1);
}

const env = {
  ...process.env,
  MONGO_URI: mongoUri,
  BACKUP_ARCHIVE: archivePath,
};

if (encryptionKey) {
  env.BACKUP_ENCRYPTION_KEY = encryptionKey;
}

if (batchSize) {
  env.RESTORE_BATCH_SIZE = batchSize;
}

if (verifyOnly) {
  env.RESTORE_VERIFY_ONLY = 'true';
}

if (dropExisting) {
  env.RESTORE_DROP_EXISTING = 'true';
}

const child = spawn(process.execPath, [path.join(__dirname, 'restoreFromBackup.js')], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
