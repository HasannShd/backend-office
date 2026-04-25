const express = require('express');
const { sendMail, getNotificationRecipient } = require('../utils/mailer');
const { renderNotificationEmail } = require('../utils/notification-email');

const router = express.Router();

const escapeHtml = (str) =>
  String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ err: 'Name, email, and phone are required.' });
    }
    if (String(name).trim().length < 2) {
      return res.status(400).json({ err: 'Please enter your full name.' });
    }
    if (!String(email).trim().includes('@')) {
      return res.status(400).json({ err: 'Please enter a valid email address.' });
    }

    const safeName = String(name).trim().slice(0, 120);
    const safeEmail = String(email).trim().slice(0, 200);
    const safePhone = String(phone).trim().slice(0, 40);
    const safeMessage = String(message || '').trim().slice(0, 2000);

    const to = getNotificationRecipient(
      'CONTACT_NOTIFY_EMAIL',
      'ATTENTION_NOTIFY_EMAIL',
      'HR_NOTIFY_EMAIL',
      'SMTP_FROM'
    );

    if (to) {
      const text = [
        'A new contact inquiry has been submitted on the LTE website.',
        '',
        `Name: ${safeName}`,
        `Email: ${safeEmail}`,
        `Phone: ${safePhone}`,
        safeMessage ? `Message:\n${safeMessage}` : 'No message provided.',
        '',
        'Regards',
        'LTE Website',
      ].join('\n');

      await sendMail({
        to,
        subject: `New Contact Inquiry: ${safeName}`,
        text,
        html: renderNotificationEmail({
          preheader: 'New contact inquiry from the LTE website',
          heading: 'New Contact Inquiry',
          introLines: ['A new contact inquiry has been submitted on the LTE website.'],
          detailRows: [
            { label: 'Name', value: safeName },
            { label: 'Email', value: safeEmail },
            { label: 'Phone', value: safePhone },
            safeMessage ? { label: 'Message', value: safeMessage } : null,
          ].filter(Boolean),
        }),
      });
    }

    return res.status(200).json({ message: 'Thank you for reaching out. We will get back to you shortly.' });
  } catch (err) {
    return res.status(500).json({ err: 'Could not submit your inquiry. Please try again.' });
  }
});

module.exports = router;
