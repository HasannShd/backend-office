const fs = require('fs');
const os = require('os');
const path = require('path');
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
