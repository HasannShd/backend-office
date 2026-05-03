const express = require('express');
const router = express.Router();

const Client = require('../models/client');
const MarketingCampaign = require('../models/marketingCampaign');
const MarketingContact = require('../models/marketingContact');
const User = require('../models/user');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');
const { sendMail, isConfigured: smtpConfigured } = require('../utils/mailer');
const { renderSocialFollowEmail } = require('../utils/marketing-email');

const LINKEDIN_URL = 'https://www.linkedin.com/company/leading-trading-est/';
const MAX_IMPORT_ROWS = 2000;
const MAX_SEND_PER_REQUEST = 1000;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const clean = (value, limit = 300) => String(value || '').trim().slice(0, limit);
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const CONTACT_FIELDS = ['email', 'name', 'companyName', 'phone', 'source', 'notes', 'consentStatus'];

const normalizeContactPayload = (row = {}) => {
  const email = normalizeEmail(row.email || row.Email || row['Email Address'] || row['email address']);
  const name = clean(row.name || row.Name || row.contactName || row['Contact Name'] || row.contact_person || row.contactPerson, 160);
  const companyName = clean(row.companyName || row.Company || row.company || row['Company Name'] || row.facility || row.Facility, 180);
  const phone = clean(row.phone || row.Phone || row.mobile || row.Mobile, 80);
  const source = clean(row.source || row.Source || 'manual_import', 80);
  const notes = clean(row.notes || row.Notes, 500);
  const consentStatus = ['existing_client', 'opted_in', 'unknown'].includes(row.consentStatus)
    ? row.consentStatus
    : 'existing_client';

  return { email, name, companyName, phone, source, notes, consentStatus };
};

const serializeContact = (contact) => ({
  _id: contact._id,
  email: contact.email,
  name: contact.name || '',
  companyName: contact.companyName || '',
  phone: contact.phone || '',
  source: contact.source || '',
  consentStatus: contact.unsubscribedAt ? 'unsubscribed' : contact.consentStatus,
  unsubscribedAt: contact.unsubscribedAt,
  lastCampaignSentAt: contact.lastCampaignSentAt,
  lastCampaignSubject: contact.lastCampaignSubject || '',
  createdAt: contact.createdAt,
  updatedAt: contact.updatedAt,
});

const upsertContact = async (payload, userId) => {
  if (!payload.email || !isValidEmail(payload.email)) {
    return { skipped: true, reason: 'Invalid email', email: payload.email };
  }

  const existing = await MarketingContact.findOne({ email: payload.email });
  if (existing) {
    CONTACT_FIELDS.forEach((field) => {
      if (field === 'email') return;
      if (payload[field]) existing[field] = payload[field];
    });
    if (!existing.importedBy && userId) existing.importedBy = userId;
    if (!existing.unsubscribedAt && existing.consentStatus === 'unsubscribed') {
      existing.consentStatus = payload.consentStatus || 'existing_client';
    }
    await existing.save();
    return { updated: true, contact: existing };
  }

  const created = await MarketingContact.create({ ...payload, importedBy: userId });
  return { created: true, contact: created };
};

router.get('/contacts', verifyToken, isAdmin, async (req, res) => {
  try {
    const contacts = await MarketingContact.find({}).sort({ updatedAt: -1 }).limit(500).lean();
    const total = await MarketingContact.countDocuments({});
    const eligible = await MarketingContact.countDocuments({ unsubscribedAt: { $exists: false } });
    const unsubscribed = await MarketingContact.countDocuments({ unsubscribedAt: { $exists: true } });
    res.json({
      contacts: contacts.map(serializeContact),
      totals: { total, eligible, unsubscribed },
      smtpConfigured: Boolean(smtpConfigured),
      defaultLinkedinUrl: LINKEDIN_URL,
    });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

router.post('/contacts/import', verifyToken, isAdmin, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.contacts) ? req.body.contacts.slice(0, MAX_IMPORT_ROWS) : [];
    if (!rows.length) return res.status(400).json({ err: 'No contacts provided.' });

    const summary = { received: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
    for (const row of rows) {
      const payload = normalizeContactPayload(row);
      const result = await upsertContact(payload, req.user?._id);
      if (result.created) summary.created += 1;
      else if (result.updated) summary.updated += 1;
      else {
        summary.skipped += 1;
        if (summary.errors.length < 20) summary.errors.push({ email: result.email || '', reason: result.reason });
      }
    }

    res.json(summary);
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

router.post('/contacts/sync-clients', verifyToken, isAdmin, async (req, res) => {
  try {
    const [clients, optedInUsers] = await Promise.all([
      Client.find({ email: { $exists: true, $ne: '' } }).select('name contactPerson phone email notes').lean(),
      User.find({ marketingOptIn: true }).select('name phone email').lean(),
    ]);

    const rows = [
      ...clients.map((client) => ({
        email: client.email,
        name: client.contactPerson,
        companyName: client.name,
        phone: client.phone,
        notes: client.notes,
        source: 'client_database',
        consentStatus: 'existing_client',
      })),
      ...optedInUsers.map((user) => ({
        email: user.email,
        name: user.name,
        phone: user.phone,
        source: 'website_opt_in',
        consentStatus: 'opted_in',
      })),
    ];

    const summary = { received: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
    for (const row of rows) {
      const result = await upsertContact(normalizeContactPayload(row), req.user?._id);
      if (result.created) summary.created += 1;
      else if (result.updated) summary.updated += 1;
      else summary.skipped += 1;
    }
    res.json(summary);
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

router.post('/campaigns/social-follow/send', verifyToken, isAdmin, async (req, res) => {
  const subject = clean(req.body?.subject || 'Follow Leading Trading Est for product updates', 160);
  const previewText = clean(req.body?.previewText || 'Stay connected with LTE on Instagram and LinkedIn.', 220);
  const instagramUrl = clean(req.body?.instagramUrl, 300);
  const linkedinUrl = clean(req.body?.linkedinUrl || LINKEDIN_URL, 300);

  if (!instagramUrl && !linkedinUrl) {
    return res.status(400).json({ err: 'Add at least one social page URL.' });
  }

  try {
    const contacts = await MarketingContact.find({ unsubscribedAt: { $exists: false } })
      .sort({ updatedAt: -1 })
      .limit(MAX_SEND_PER_REQUEST);

    if (!contacts.length) return res.status(400).json({ err: 'No eligible contacts to send.' });

    const campaign = await MarketingCampaign.create({
      type: 'social_follow',
      subject,
      previewText,
      instagramUrl,
      linkedinUrl,
      createdBy: req.user?._id,
      status: 'sending',
      startedAt: new Date(),
      totals: { targeted: contacts.length, sent: 0, skipped: 0, failed: 0 },
      recipients: contacts.map((contact) => ({
        contact: contact._id,
        email: contact.email,
        name: contact.name,
        companyName: contact.companyName,
      })),
    });

    for (const contact of contacts) {
      const recipient = campaign.recipients.find((entry) => entry.email === contact.email);
      if (!isValidEmail(contact.email)) {
        recipient.status = 'skipped';
        recipient.error = 'Invalid email';
        campaign.totals.skipped += 1;
        continue;
      }

      try {
        const { text, html } = renderSocialFollowEmail({ contact, subject, previewText, instagramUrl, linkedinUrl });
        const result = await sendMail({ to: contact.email, subject, text, html });
        if (result?.skipped) {
          recipient.status = 'skipped';
          recipient.error = 'SMTP not configured';
          campaign.totals.skipped += 1;
        } else {
          recipient.status = 'sent';
          recipient.messageId = result?.messageId || '';
          recipient.sentAt = new Date();
          campaign.totals.sent += 1;
          contact.lastCampaignSentAt = recipient.sentAt;
          contact.lastCampaignSubject = subject;
          await contact.save();
        }
      } catch (err) {
        recipient.status = 'failed';
        recipient.error = err.message;
        campaign.totals.failed += 1;
      }
    }

    campaign.status = campaign.totals.failed
      ? 'completed_with_errors'
      : campaign.totals.sent
        ? 'completed'
        : 'failed';
    campaign.completedAt = new Date();
    await campaign.save();

    res.json({
      campaignId: campaign._id,
      status: campaign.status,
      totals: campaign.totals,
      smtpConfigured: Boolean(smtpConfigured),
    });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

router.get('/campaigns', verifyToken, isAdmin, async (req, res) => {
  try {
    const campaigns = await MarketingCampaign.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .select('subject status totals createdAt startedAt completedAt instagramUrl linkedinUrl')
      .lean();
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

router.get('/unsubscribe/:token', async (req, res) => {
  try {
    const contact = await MarketingContact.findOne({ unsubscribeToken: req.params.token });
    if (contact && !contact.unsubscribedAt) {
      contact.unsubscribedAt = new Date();
      contact.consentStatus = 'unsubscribed';
      await contact.save();
    }
    res.type('html').send(`<!doctype html>
      <html><head><title>Unsubscribed | Leading Trading Est</title></head>
      <body style="font-family:Arial,sans-serif;padding:32px;line-height:1.6;color:#102033;">
        <h1>Unsubscribed</h1>
        <p>You have been removed from future Leading Trading Est marketing emails.</p>
      </body></html>`);
  } catch (err) {
    res.status(500).send('Unable to process unsubscribe request.');
  }
});

module.exports = router;
