const express = require('express');
const { sendMail, getNotificationRecipient } = require('../utils/mailer');
const { renderNotificationEmail } = require('../utils/notification-email');
const ContactInquiry = require('../models/contactInquiry');

const router = express.Router();

const escapeHtml = (str) =>
  String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clean = (value, max = 200) => String(value || '').trim().slice(0, max);

const verifyTurnstile = async ({ token, ipAddress }) => {
  const secret = process.env.TURNSTILE_SECRET_KEY || process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (ipAddress) body.set('remoteip', ipAddress);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const result = await response.json().catch(() => ({}));
  return !!result.success;
};

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
    const {
      name,
      email,
      phone,
      company,
      quantity,
      urgency,
      preferredContact,
      message,
      quoteContext,
      consent,
      turnstileToken,
      cfTurnstileToken,
    } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ err: 'Name, email, and phone are required.' });
    }
    if (consent !== true) {
      return res.status(400).json({ err: 'Consent is required before submitting an inquiry.' });
    }
    if (String(name).trim().length < 2) {
      return res.status(400).json({ err: 'Please enter your full name.' });
    }
    if (!String(email).trim().includes('@')) {
      return res.status(400).json({ err: 'Please enter a valid email address.' });
    }
    const turnstileOk = await verifyTurnstile({
      token: turnstileToken || cfTurnstileToken,
      ipAddress: req.ip,
    });
    if (!turnstileOk) {
      return res.status(403).json({ err: 'Bot verification failed. Please refresh and try again.' });
    }

    const safeName = clean(name, 120);
    const safeEmail = clean(email, 200);
    const safePhone = clean(phone, 40);
    const safeCompany = clean(company, 180);
    const safeQuantity = clean(quantity, 120);
    const safeUrgency = clean(urgency, 80);
    const safePreferredContact = clean(preferredContact, 80);
    const safeMessage = clean(message, 2000);
    const quoteRows = buildQuoteContextRows(quoteContext);
    const safeQuoteContext = {
      source: clean(quoteContext?.source, 80),
      productId: clean(quoteContext?.productId, 80),
      productName: clean(quoteContext?.productName, 180),
      sku: clean(quoteContext?.sku, 80),
      categoryId: clean(quoteContext?.categoryId, 80),
      categoryName: clean(quoteContext?.categoryName, 160),
      pageUrl: clean(quoteContext?.pageUrl, 500),
    };

    const inquiry = await ContactInquiry.create({
      name: safeName,
      email: safeEmail,
      phone: safePhone,
      company: safeCompany,
      quantity: safeQuantity,
      urgency: safeUrgency,
      preferredContact: safePreferredContact,
      message: safeMessage,
      quoteContext: safeQuoteContext,
      consent: true,
      userAgent: clean(req.get('user-agent'), 500),
      ipAddress: clean(req.ip, 80),
    });

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
        safeCompany ? `Company / facility: ${safeCompany}` : '',
        safeQuantity ? `Quantity: ${safeQuantity}` : '',
        safeUrgency ? `Urgency: ${safeUrgency}` : '',
        safePreferredContact ? `Preferred contact: ${safePreferredContact}` : '',
        quoteRows.length ? `Quote context:\n${quoteRows.map((row) => `${row.label}: ${row.value}`).join('\n')}` : '',
        safeMessage ? `Message:\n${safeMessage}` : 'No message provided.',
        '',
        'Regards',
        'LTE Website',
      ].filter((line) => line !== '').join('\n');

      try {
        await sendMail({
          to,
          subject: quoteSubject ? `New Quote Inquiry: ${quoteSubject} - ${safeName}` : `New Contact Inquiry: ${safeName}`,
          text,
          html: renderNotificationEmail({
            preheader: 'New contact inquiry from the LTE website',
            heading: 'New Contact Inquiry',
            introLines: ['A new contact inquiry has been submitted on the LTE website.'],
            detailRows: [
              { label: 'Inquiry ID', value: inquiry._id.toString() },
              { label: 'Name', value: safeName },
              { label: 'Email', value: safeEmail },
              { label: 'Phone', value: safePhone },
              safeCompany ? { label: 'Company / facility', value: safeCompany } : null,
              safeQuantity ? { label: 'Quantity', value: safeQuantity } : null,
              safeUrgency ? { label: 'Urgency', value: safeUrgency } : null,
              safePreferredContact ? { label: 'Preferred contact', value: safePreferredContact } : null,
              ...quoteRows,
              safeMessage ? { label: 'Message', value: safeMessage } : null,
            ].filter(Boolean),
          }),
        });
        inquiry.status = 'notified';
        await inquiry.save();
      } catch (mailError) {
        inquiry.status = 'notification_failed';
        inquiry.notificationError = clean(mailError.message, 500);
        await inquiry.save();
        console.error('[contact] notification failed', mailError);
      }
    }

    return res.status(200).json({
      message: 'Thank you for reaching out. We will get back to you shortly.',
      inquiryId: inquiry._id,
    });
  } catch (err) {
    return res.status(500).json({ err: 'Could not submit your inquiry. Please try again.' });
  }
});

module.exports = router;
