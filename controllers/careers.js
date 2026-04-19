const express = require('express');
const multer = require('multer');
const { sendMail, getNotificationRecipient } = require('../utils/mailer');
const { renderNotificationEmail } = require('../utils/notification-email');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/apply', upload.single('cv'), async (req, res) => {
  try {
    const { name, phone, nationality, email } = req.body;
    if (!name || !phone || !nationality || !req.file) {
      return res.status(400).json({ message: 'All fields and CV are required.' });
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
            filename: req.file.originalname,
            content: req.file.buffer,
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
