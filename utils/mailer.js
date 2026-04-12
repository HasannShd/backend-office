const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
} = process.env;

const isConfigured = SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM;

let transporter = null;

if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

const sendMail = async ({ to, subject, text, html, attachments }) => {
  if (!transporter) {
    console.log('[mailer] Email not sent (SMTP not configured):', subject);
    return { skipped: true };
  }

  return transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
    html,
    attachments,
  });
};

const getNotificationRecipient = (...keys) => {
  const values = keys
    .map((key) => process.env[key])
    .filter((value) => typeof value === 'string' && value.trim());
  return values[0] || '';
};

module.exports = { sendMail, isConfigured, getNotificationRecipient };
