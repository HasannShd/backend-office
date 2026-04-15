# LTE Backend

Express + MongoDB backend for the LTE website, ecommerce flow, and internal staff/admin portal.

## What This API Serves

- Public catalog APIs
- Customer auth, cart, checkout, and order history
- Admin catalog and website-management APIs
- Staff operations portal APIs
- Admin operations portal APIs
- Cloudinary uploads
- SMTP email notifications
- Nightly MongoDB backups to Google Drive via GitHub Actions

## Main Route Groups

Auth and users:

- `/api/auth`
- `/api/users`

Public website and ecommerce:

- `/api/categories`
- `/api/products`
- `/api/cart`
- `/api/orders`
- `/api/careers`
- `/api/ai`

Staff portal:

- `/api/staff-portal/dashboard`
- `/api/staff-portal/attendance`
- `/api/staff-portal/reports`
- `/api/staff-portal/orders`
- `/api/staff-portal/clients`
- `/api/staff-portal/visits`
- `/api/staff-portal/notifications`
- `/api/staff-portal/messages`

Admin portal:

- `/api/admin-portal/dashboard`
- `/api/admin-portal/staff`
- `/api/admin-portal/attendance`
- `/api/admin-portal/reports`
- `/api/admin-portal/orders`
- `/api/admin-portal/clients`
- `/api/admin-portal/visits`
- `/api/admin-portal/notifications`
- `/api/admin-portal/activity-logs`
- `/api/admin-portal/exports/:resource`
- `/api/admin-portal/messages`

## Auth Model

The backend supports 3 auth scopes:

- `user`
- `sales_staff`
- `admin`

Admin auth includes:

- password-strength enforcement
- failed-login lockout
- TOTP MFA
- trusted devices
- password-reset flow

## Core Models

- `User`
- `Category`
- `Product`
- `Cart`
- `Order`
- `AttendanceLog`
- `DailyReport`
- `SalesOrder`
- `Client`
- `ClientVisit`
- `Notification`
- `MessageThread`
- `ActivityLog`

Some additional models exist for future expansion, but the routes above are the currently active feature surface.

## Environment

Copy `.env.example` to `.env`.

Required:

- `MONGO_URI`
- `JWT_SECRET`

Uploads:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Web push notifications:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Email:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Optional notification inboxes:

- `WEBSITE_ORDER_NOTIFY_EMAIL`
- `ORDER_NOTIFY_EMAIL`
- `SALES_ORDER_NOTIFY_EMAIL`
- `CV_NOTIFY_EMAIL`
- `CAREERS_NOTIFY_EMAIL`
- `HR_NOTIFY_EMAIL`
- `ATTENTION_NOTIFY_EMAIL`

AI providers:

- `AI_DEFAULT_PROVIDER` (`openai` or `anthropic`)
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`

## Run

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
```

Current automated coverage is lightweight and focused on critical utility behavior:

- auth token extraction and password validation
- backup filename and export serialization helpers
- backup archive verification and restore structure checks
- AI request normalization and provider availability reporting

## AI Endpoint

Authenticated users can call:

- `GET /api/ai/providers`
- `POST /api/ai/generate`

Example request:

```json
{
  "provider": "anthropic",
  "model": "claude-3-5-haiku-20241022",
  "system": "You are a concise operations assistant.",
  "prompt": "Summarize today's orders in three bullets.",
  "temperature": 0.2,
  "maxTokens": 400
}
```

You can also send a `messages` array with `system`, `user`, and `assistant` roles. The backend normalizes that payload and routes it to the selected provider.

## Website Order Flow

- cart is read from MongoDB
- checkout creates an `Order`
- order email is sent through SMTP if configured
- invoice PDFs can be downloaded later

Tap card payment is not live yet. The endpoint is present, but checkout still returns a pending/not-available response for Tap.

## Staff Order Flow

- staff submit sales orders into MongoDB
- the backend emails the company inbox if SMTP is configured
- order status history is tracked
- staff can receive web push notifications for admin replies and order status updates
- Tally sync status is reserved for future work, but Tally is not implemented yet

## Uploads

`/api/upload` accepts authenticated admin and staff uploads:

- images
- PDF files

Cloudinary folders:

- `LTE-products`
- `LTE-documents`

## GitHub Backups

The backend repo contains a GitHub Actions workflow at [`.github/workflows/backup-to-drive.yml`](./.github/workflows/backup-to-drive.yml).

It:

- exports every MongoDB collection to JSONL
- bundles the export into a `.tgz`
- optionally encrypts the archive into `.tgz.enc`
- verifies the archive can be parsed before upload
- uploads the latest archive to Google Drive
- opens a GitHub issue automatically if the workflow fails

Required GitHub secrets:

- `MONGO_URI`
- `GDRIVE_FOLDER_ID`

Google Drive auth, choose one:

- OAuth:
  - `GDRIVE_OAUTH_CLIENT_ID`
  - `GDRIVE_OAUTH_CLIENT_SECRET`
  - `GDRIVE_OAUTH_REFRESH_TOKEN`
- Service account:
  - `GDRIVE_SERVICE_ACCOUNT_JSON`

Optional:

- `BACKUP_ENCRYPTION_KEY`
- `BACKUP_FILENAME`
- `BACKUP_PREFIX`
- `BACKUP_TZ`

If encryption is enabled, the uploaded filename is automatically normalized to end in `.enc`.

## Restore

```bash
MONGO_URI="..." BACKUP_ARCHIVE="/path/to/archive.tgz" RESTORE_DROP_EXISTING=true npm run restore:backup
```

Verify an archive without writing to MongoDB:

```bash
MONGO_URI="..." BACKUP_ARCHIVE="/path/to/archive.tgz" npm run restore:verify
```

Easier local/server wrapper using `.env`:

```bash
npm run restore:file -- --archive /path/to/archive.tgz.enc --verify
npm run restore:file -- --archive /path/to/archive.tgz.enc --drop-existing
```

Notes:

- `restore:file` reads `MONGO_URI` and `BACKUP_ENCRYPTION_KEY` from `.env` automatically
- add `--mongo-uri` or `--encryption-key` only if you want to override `.env`
- `--verify` checks the archive without writing to MongoDB
- `--drop-existing` clears the current database collections before restoring

## CI

- GitHub Actions now runs `npm test` on pushes to `main` and on pull requests
