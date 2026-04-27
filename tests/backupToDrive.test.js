const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const {
  getUploadFilename,
  getLatestAliasFilename,
  getMetadataFilename,
  getMetadataAliasFilename,
  getDriveAuthFailureMessage,
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

test('getMetadataFilename maps archive to readable metadata file', () => {
  assert.equal(
    getMetadataFilename('/tmp/lte-backup-2026-04-19-230000.tgz.enc'),
    'lte-backup-2026-04-19-230000.metadata.json'
  );
});

test('getMetadataAliasFilename returns configured alias', () => {
  const original = process.env.BACKUP_METADATA_ALIAS;
  process.env.BACKUP_METADATA_ALIAS = 'lte-backup-latest.metadata.json';

  assert.equal(getMetadataAliasFilename(), 'lte-backup-latest.metadata.json');

  if (typeof original === 'string') process.env.BACKUP_METADATA_ALIAS = original;
  else delete process.env.BACKUP_METADATA_ALIAS;
});

test('getDriveAuthFailureMessage explains revoked OAuth refresh token', () => {
  const error = {
    response: {
      data: {
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
      },
    },
  };

  const message = getDriveAuthFailureMessage(error);

  assert.match(message, /GDRIVE_OAUTH_REFRESH_TOKEN/);
  assert.match(message, /created and verified/);
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
