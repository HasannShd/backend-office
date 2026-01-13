# Express JWT Auth Template

## About

This repo is an Express JWT Auth template meant to be paired with a front-end app utilizing JWT tokens.

## Getting started

Fork and clone this repository to your local machine.

After moving into the cloned directory, run `npm i` to download the dependencies.

Create a `.env` file in the root of the project:

```bash
touch .env
```

and add your MongoDB URI and a secret JWT string to it. Your MongoDB URI will look something like the first entry, but with your username and password:

```plaintext
MONGODB_URI=mongodb+srv://<username>:<password>@sei.azure.mongodb.net/myApp?retryWrites=true
JWT_SECRET=supersecret
CLIENT_URL=http://localhost:5173
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-pass
SMTP_FROM=office@example.com
ORDER_NOTIFY_EMAIL=orders@example.com
CAREERS_NOTIFY_EMAIL=careers@example.com
TAP_SECRET_KEY=your-tap-secret
TAP_PUBLIC_KEY=your-tap-public
```

Start the app in your terminal with:

``` sh
npm run dev
```
