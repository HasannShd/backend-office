const express = require('express');
const { sendMail, getNotificationRecipient } = require('../utils/mailer');
const { renderNotificationEmail } = require('../utils/notification-email');

const router = express.Router();

const escapeHtml = (str) =>
  String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clean = (value, max = 200) => String(value || '').trim().slice(0, max);

const buildQuoteContextRows = (quoteContext = {}) => {
  if (!quoteContext || typeof quoteContext !== 'object') return [];

  return [
    { label: 'Quote Source', value: clean(quoteContext.source, 80) },
    { label: 'Product', value: clean(quoteContext.productName, 180) },
    { label: 'Product ID', value: clean(quoteContext.productId, 80) },
    { label: 'SKU', value: clean(quoteContext.sku, 80) },
    { label: 'Category', value: clean(quoteContext.categoryName, 160) },
    { label: 'Category ID', value: clean(quoteContext.categoryId, 80) },
    { label: 'Page URL', value: clean(quoteContext.pageUrl, 500) },
  ].filter((row) => row.value);
};

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, message, quoteContext } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ err: 'Name, email, and phone are required.' });
    }
    if (String(name).trim().length < 2) {
      return res.status(400).json({ err: 'Please enter your full name.' });
    }
    if (!String(email).trim().includes('@')) {
      return res.status(400).json({ err: 'Please enter a valid email address.' });
    }

    const safeName = clean(name, 120);
    const safeEmail = clean(email, 200);
    const safePhone = clean(phone, 40);
    const safeMessage = clean(message, 2000);
    const quoteRows = buildQuoteContextRows(quoteContext);

    const to = getNotificationRecipient(
      'CONTACT_NOTIFY_EMAIL',
      'ATTENTION_NOTIFY_EMAIL',
      'HR_NOTIFY_EMAIL',
      'SMTP_FROM'
    );

    if (to) {
      const quoteSubject = quoteRows.find((row) => row.label === 'Product')?.value ||
        quoteRows.find((row) => row.label === 'Category')?.value;
      const text = [
        'A new contact inquiry has been submitted on the LTE website.',
        '',
        `Name: ${safeName}`,
        `Email: ${safeEmail}`,
        `Phone: ${safePhone}`,
        quoteRows.length ? `Quote context:\n${quoteRows.map((row) => `${row.label}: ${row.value}`).join('\n')}` : '',
        safeMessage ? `Message:\n${safeMessage}` : 'No message provided.',
        '',
        'Regards',
        'LTE Website',
      ].join('\n');

      await sendMail({
        to,
        subject: quoteSubject ? `New Quote Inquiry: ${quoteSubject} - ${safeName}` : `New Contact Inquiry: ${safeName}`,
        text,
        html: renderNotificationEmail({
          preheader: 'New contact inquiry from the LTE website',
          heading: 'New Contact Inquiry',
          introLines: ['A new contact inquiry has been submitted on the LTE website.'],
          detailRows: [
            { label: 'Name', value: safeName },
            { label: 'Email', value: safeEmail },
            { label: 'Phone', value: safePhone },
            ...quoteRows,
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
