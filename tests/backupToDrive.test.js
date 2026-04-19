const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const {
  getUploadFilename,
  getLatestAliasFilename,
  toExtendedJson,
} = require('../scripts/backupToDrive');

const restoreBackupFilename = (value) => {
  if (typeof value === 'string') {
    process.env.BACKUP_FILENAME = value;
    return;
  }
  delete process.env.BACKUP_FILENAME;
};

test('getUploadFilename uses encrypted extension when needed', () => {
  const original = process.env.BACKUP_FILENAME;
  process.env.BACKUP_FILENAME = 'nightly-backup.tgz';

  assert.equal(
    getUploadFilename('/tmp/nightly-backup.tgz.enc'),
    'nightly-backup.tgz.enc'
  );

  restoreBackupFilename(original);
});

test('getUploadFilename returns timestamped archive name by default', () => {
  const original = process.env.BACKUP_FILENAME;
  restoreBackupFilename(undefined);

  assert.equal(getUploadFilename('/tmp/lte-backup-2026-04-19-230000.tgz'), 'lte-backup-2026-04-19-230000.tgz');
  assert.equal(getUploadFilename('/tmp/lte-backup-2026-04-19-230000.tgz.enc'), 'lte-backup-2026-04-19-230000.tgz.enc');

  restoreBackupFilename(original);
});

test('getLatestAliasFilename honors encrypted extension when configured', () => {
  const original = process.env.BACKUP_LATEST_ALIAS;
  process.env.BACKUP_LATEST_ALIAS = 'lte-backup-latest.tgz';

  assert.equal(
    getLatestAliasFilename('/tmp/lte-backup-2026-04-19-230000.tgz.enc'),
    'lte-backup-latest.tgz.enc'
  );

  if (typeof original === 'string') process.env.BACKUP_LATEST_ALIAS = original;
  else delete process.env.BACKUP_LATEST_ALIAS;
});

test('toExtendedJson serializes ObjectId and Date values', () => {
  const input = {
    _id: new ObjectId('507f1f77bcf86cd799439011'),
    createdAt: new Date('2026-04-14T00:00:00.000Z'),
  };

  const output = toExtendedJson(input);

  assert.deepEqual(output, {
    _id: { $oid: '507f1f77bcf86cd799439011' },
    createdAt: { $date: '2026-04-14T00:00:00.000Z' },
  });
});
