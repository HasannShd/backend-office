const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const tar = require('tar');

const {
  listCollections,
  verifyArchive,
} = require('../scripts/restoreFromBackup');

test('listCollections reads metadata first', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lte-restore-test-'));

  try {
    fs.writeFileSync(path.join(tempDir, 'metadata.json'), JSON.stringify({
      collections: [{ name: 'orders' }, { name: 'messages' }],
    }));

    assert.deepEqual(listCollections(tempDir), ['orders', 'messages']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('verifyArchive validates exported collection files', async () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lte-backup-source-'));
  const archivePath = path.join(os.tmpdir(), `lte-backup-${Date.now()}.tgz`);

  try {
    fs.writeFileSync(path.join(sourceDir, 'metadata.json'), JSON.stringify({
      collections: [{ name: 'orders' }],
    }));
    fs.writeFileSync(path.join(sourceDir, 'orders.jsonl'), `${JSON.stringify({ _id: { $oid: '507f1f77bcf86cd799439011' } })}\n`);

    await tar.c({ gzip: true, file: archivePath, cwd: sourceDir }, ['.']);

    const verified = await verifyArchive(archivePath);
    assert.deepEqual(verified, [{ name: 'orders', count: 1 }]);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(archivePath, { force: true });
  }
});

test('verifyArchive trims encryption key whitespace for encrypted archives', async () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lte-backup-encrypted-source-'));
  const archivePath = path.join(os.tmpdir(), `lte-backup-${Date.now()}.tgz`);
  const encryptedArchivePath = `${archivePath}.enc`;
  const originalKey = process.env.BACKUP_ENCRYPTION_KEY;

  try {
    fs.writeFileSync(path.join(sourceDir, 'metadata.json'), JSON.stringify({
      collections: [{ name: 'orders' }],
    }));
    fs.writeFileSync(path.join(sourceDir, 'orders.jsonl'), `${JSON.stringify({ _id: { $oid: '507f1f77bcf86cd799439011' } })}\n`);

    await tar.c({ gzip: true, file: archivePath, cwd: sourceDir }, ['.']);

    const key = crypto.createHash('sha256').update('secret-key').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      iv,
      cipher.update(fs.readFileSync(archivePath)),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    fs.writeFileSync(encryptedArchivePath, encrypted);

    process.env.BACKUP_ENCRYPTION_KEY = 'secret-key\n';
    const verified = await verifyArchive(encryptedArchivePath);
    assert.deepEqual(verified, [{ name: 'orders', count: 1 }]);
  } finally {
    if (typeof originalKey === 'string') process.env.BACKUP_ENCRYPTION_KEY = originalKey;
    else delete process.env.BACKUP_ENCRYPTION_KEY;
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(archivePath, { force: true });
    fs.rmSync(encryptedArchivePath, { force: true });
  }
});
