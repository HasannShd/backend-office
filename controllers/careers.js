const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { sendMail, getNotificationRecipient } = require('../utils/mailer');
const { renderNotificationEmail } = require('../utils/notification-email');

const router = express.Router();
const allowedCvExtensions = new Set(['.pdf', '.doc', '.docx']);
const allowedCvMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const isAllowedCvFile = (file) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  return allowedCvExtensions.has(extension) && allowedCvMimeTypes.has(file.mimetype);
};

const buildSafeCvFilename = (file) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  return `cv_${crypto.randomBytes(12).toString('hex')}${extension}`;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!isAllowedCvFile(file)) {
      return callback(new Error('Only PDF, DOC, or DOCX CV files are accepted.'));
    }
    return callback(null, true);
  },
});

const uploadCv = (req, res, next) => {
  upload.single('cv')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'CV file must be 5MB or smaller.'
      : error.message || 'Invalid CV file upload.';
    return res.status(400).json({ message });
  });
};

router.post('/apply', uploadCv, async (req, res) => {
  try {
    const { name, phone, nationality, email } = req.body;
    if (!name || !phone || !nationality || !req.file) {
      return res.status(400).json({ message: 'All fields and CV are required.' });
    }
    if (!isAllowedCvFile(req.file)) {
      return res.status(400).json({ message: 'Only PDF, DOC, or DOCX CV files are accepted.' });
    }

    const to = getNotificationRecipient(
      'CV_NOTIFY_EMAIL',
      'CAREERS_NOTIFY_EMAIL',
      'ATTENTION_NOTIFY_EMAIL',
      'HR_NOTIFY_EMAIL',
      'SMTP_FROM'
    );
    if (to) {
      const text = [
        'Dear Madam,',
        '',
        'A new CV application has been submitted.',
        '',
        `Name: ${name}`,
        `Phone: ${phone}`,
        `Nationality: ${nationality}`,
        `Email: ${email || '-'}`,
        '',
        'The applicant CV is attached to this email.',
        '',
        'Regards',
        'Leading Trading Team',
        'HR Department',
      ].join('\n');
      await sendMail({
        to,
        subject: `New CV Application: ${name}`,
        text,
        html: renderNotificationEmail({
          preheader: 'LTE Careers Notification',
          heading: 'New CV Application',
          introLines: [
            'Dear Madam,',
            'A new CV application has been submitted.',
          ],
          detailRows: [
            { label: 'Name', value: name },
            { label: 'Phone', value: phone },
            { label: 'Nationality', value: nationality },
            { label: 'Email', value: email || '-' },
          ],
          footerNote: 'The applicant CV is attached to this email.',
          signoffRole: 'HR Department',
        }),
        attachments: [
          {
            filename: buildSafeCvFilename(req.file),
            content: req.file.buffer,
            contentType: req.file.mimetype,
          },
        ],
      });
    } else {
      console.log('[careers] CV received but no careers notification email configured');
    }

    res.status(201).json({ message: 'Application received' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
