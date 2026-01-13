const express = require('express');
const multer = require('multer');
const { sendMail } = require('../utils/mailer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/apply', upload.single('cv'), async (req, res) => {
  try {
    const { name, phone, nationality, email } = req.body;
    if (!name || !phone || !nationality || !req.file) {
      return res.status(400).json({ message: 'All fields and CV are required.' });
    }

    const to = process.env.CAREERS_NOTIFY_EMAIL || process.env.SMTP_FROM;
    if (to) {
      await sendMail({
        to,
        subject: `New CV Application: ${name}`,
        text: `Name: ${name}\nPhone: ${phone}\nNationality: ${nationality}\nEmail: ${email || '-'}`,
        attachments: [
          {
            filename: req.file.originalname,
            content: req.file.buffer,
          },
        ],
      });
    } else {
      console.log('[careers] CV received but no CAREERS_NOTIFY_EMAIL configured');
    }

    res.status(201).json({ message: 'Application received' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
