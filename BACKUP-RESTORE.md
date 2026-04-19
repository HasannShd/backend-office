# Backup And Restore

## What You Will See In Google Drive

Each successful backup run can upload:

- a backup archive:
  - `lte-backup-YYYY-MM-DD-HHMMSS.tgz`
  - or `lte-backup-YYYY-MM-DD-HHMMSS.tgz.enc` when encryption is enabled
- a readable metadata file:
  - `lte-backup-YYYY-MM-DD-HHMMSS.metadata.json`

The archive is the real backup.

The metadata file is there so you can inspect:

- backup timestamp
- database name
- exported collection names
- document counts per collection

Google Drive will usually preview the `.metadata.json` file, but it will not preview `.tgz` or `.tgz.enc` archives.

## Why The Archive Does Not Open In Drive

- `.tgz` is a compressed archive
- `.tgz.enc` is an encrypted compressed archive

That means the file is valid, but it is not a document preview format.

If the backup is encrypted, it must be restored with the correct `BACKUP_ENCRYPTION_KEY`.

## Verify A Backup Without Restoring

```bash
cd /home/asns/office/backend-office
npm run restore:file -- --archive /path/to/lte-backup-YYYY-MM-DD-HHMMSS.tgz.enc --verify
```

For unencrypted backups:

```bash
cd /home/asns/office/backend-office
npm run restore:file -- --archive /path/to/lte-backup-YYYY-MM-DD-HHMMSS.tgz --verify
```

## Fully Restore A Backup

```bash
cd /home/asns/office/backend-office
npm run restore:file -- --archive /path/to/lte-backup-YYYY-MM-DD-HHMMSS.tgz.enc --drop-existing
```

Important:

- `--verify` is safe and does not write to MongoDB
- `--drop-existing` replaces current data, so do not use it casually on production

## Required Environment For Encrypted Backups

Your backend `.env` must contain:

- `MONGO_URI`
- `BACKUP_ENCRYPTION_KEY` for `.tgz.enc` files

## Optional Stable Alias Files

If you want one rolling alias in Drive in addition to the timestamped backups, you can set:

- `BACKUP_LATEST_ALIAS`
- `BACKUP_METADATA_ALIAS`

Example:

- `BACKUP_LATEST_ALIAS=lte-backup-latest.tgz`
- `BACKUP_METADATA_ALIAS=lte-backup-latest.metadata.json`

This keeps:

- dated backups for retention
- one stable latest archive name
- one stable latest metadata name
