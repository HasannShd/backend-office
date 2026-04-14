# LTE Backend

## Overview

This backend now serves three surfaces from the same Express + MongoDB app:

- public LTE website APIs
- existing product/category/admin management APIs
- the new internal sales operations portal APIs

The new portal is role-based:

- `admin`
- `sales_staff`

Customer/public users keep the existing `user` role so the website storefront is not disrupted.

## Portal API Structure

Staff-facing APIs:

- `/api/staff-portal/dashboard`
- `/api/staff-portal/attendance`
- `/api/staff-portal/schedules`
- `/api/staff-portal/reports`
- `/api/staff-portal/orders`
- `/api/staff-portal/expenses`
- `/api/staff-portal/clients`
- `/api/staff-portal/visits`
- `/api/staff-portal/collections`
- `/api/staff-portal/notifications`

Admin-facing APIs:

- `/api/admin-portal/dashboard`
- `/api/admin-portal/staff`
- `/api/admin-portal/attendance`
- `/api/admin-portal/schedules`
- `/api/admin-portal/reports`
- `/api/admin-portal/orders`
- `/api/admin-portal/expenses`
- `/api/admin-portal/clients`
- `/api/admin-portal/visits`
- `/api/admin-portal/collections`
- `/api/admin-portal/notifications`
- `/api/admin-portal/activity-logs`
- `/api/admin-portal/exports/:resource`

## Portal Data Models

The portal adds these models:

- `AttendanceLog`
- `Schedule`
- `DailyReport`
- `SalesOrder`
- `ExpenseRequest`
- `ActivityLog`
- `Client`
- `ClientVisit`
- `CollectionLog`
- `Notification`

## Environment Setup

Copy `.env.example` to `.env` and fill the values:

```bash
cp .env.example .env
```

Required:

- `MONGO_URI`
- `JWT_SECRET`

Needed for email workflow:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `ATTENTION_NOTIFY_EMAIL`
- `SALES_ORDER_NOTIFY_EMAIL`

Useful optional inboxes:

- `WEBSITE_ORDER_NOTIFY_EMAIL`
- `ORDER_NOTIFY_EMAIL`
- `CV_NOTIFY_EMAIL`
- `CAREERS_NOTIFY_EMAIL`
- `HR_NOTIFY_EMAIL`

Needed for uploads:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

`MONGODB_URI` is still accepted, but `MONGO_URI` is preferred.

## First Admin Setup

1. Register a normal user from the frontend or directly in MongoDB.
2. Promote that account:

```bash
node scripts/promoteAdmin.js <username>
```

3. Log in at the admin portal.

## Running Locally

```bash
npm install
npm run dev
```

## Order Email Workflow

Sales staff orders are saved in MongoDB first, then emailed to the company mailbox via Nodemailer.

Current behavior:

- save order
- send formatted email
- track `emailSent`, `emailSentAt`, and `emailError`
- keep `tallySyncStatus` ready for future integration

Tally is intentionally not implemented yet.

## Upload Workflow

`/api/upload` now supports:

- admin uploads
- sales staff uploads
- image files
- PDF files

Current Cloudinary folders:

- `LTE-products`
- `LTE-documents`

## Backups (Google Drive via GitHub Actions)

This repo includes a nightly backup workflow that exports every MongoDB collection to JSONL,
bundles it into a `.tgz`, and uploads it to Google Drive.

Required GitHub Secrets (repo Settings → Secrets and variables → Actions):
- `MONGO_URI`
- `GDRIVE_FOLDER_ID`

Use one of these credential methods:
- OAuth (recommended for personal Drive):
  - `GDRIVE_OAUTH_CLIENT_ID`
  - `GDRIVE_OAUTH_CLIENT_SECRET`
  - `GDRIVE_OAUTH_REFRESH_TOKEN`
- Service Account (requires Shared Drive):
  - `GDRIVE_SERVICE_ACCOUNT_JSON` (service account JSON, or base64 of it)

Optional:
- `BACKUP_ENCRYPTION_KEY`
  If set, the workflow uploads an encrypted `.tgz.enc` archive.
  If not set, the workflow uploads a plain `.tgz` archive so nightly backups still run.
- `BACKUP_FILENAME`
  Optional stable Google Drive filename. If omitted, the workflow overwrites `lte-backup-latest.tgz`.

The schedule is set to 11:00 PM Bahrain time (20:00 UTC).

Manual run:
- GitHub → Actions → "Nightly MongoDB Backup to Google Drive" → Run workflow

Notes:
- By default the backup overwrites a single file named `lte-backup-latest.tgz`.
- Change the name with `BACKUP_FILENAME` if needed, but keep it stable if you want one overwritten file only.

## Restore From Backup

Restore a `.tgz` backup into MongoDB. This inserts every document from every collection.

Required env:
- `MONGO_URI`
- `BACKUP_ARCHIVE` (path to `.tgz`)

Optional:
- `RESTORE_DROP_EXISTING=true` (delete existing docs before inserting)
- `RESTORE_BATCH_SIZE=1000`

Example:

```bash
MONGO_URI="..." BACKUP_ARCHIVE="/path/to/lte-backup-latest.tgz" RESTORE_DROP_EXISTING=true npm run restore:backup
```

## Notes For Future Tally Integration

The portal order flow already separates submission from downstream integration. When Tally work starts later, add it behind the existing sales order notification/service layer instead of embedding it directly in the controller.
