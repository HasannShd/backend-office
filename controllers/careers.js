const express = require('express');
const multer = require('multer');
const { sendMail, getNotificationRecipient } = require('../utils/mailer');

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
      await sendMail({
        to,
        subject: `New CV Application: ${name}`,
        text: `Name: ${name}\nPhone: ${phone}\nNationality: ${nationality}\nEmail: ${email || '-'}`,
        html: `
          <div style="font-family: Arial, sans-serif; color: #13273f; line-height: 1.6;">
            <h2 style="margin:0 0 12px;">New CV Application</h2>
            <table style="width:100%; border-collapse:collapse;">
              <tr>
                <td style="padding:10px; border:1px solid #e6dccd;"><strong>Name</strong><br />${name}</td>
                <td style="padding:10px; border:1px solid #e6dccd;"><strong>Phone</strong><br />${phone}</td>
              </tr>
              <tr>
                <td style="padding:10px; border:1px solid #e6dccd;"><strong>Nationality</strong><br />${nationality}</td>
                <td style="padding:10px; border:1px solid #e6dccd;"><strong>Email</strong><br />${email || '-'}</td>
              </tr>
            </table>
            <p style="margin-top:16px;">The applicant CV is attached to this email.</p>
          </div>
        `,
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
