require('dotenv').config();

const mongoose = require('mongoose');
const Client = require('../models/client');
const MarketingCampaign = require('../models/marketingCampaign');
const MarketingContact = require('../models/marketingContact');
const User = require('../models/user');

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const TAG = process.env.CAMPAIGN_TAG || 'new-social-follow-2026-05-11';
const SCHEDULED_AT = new Date(process.env.CAMPAIGN_SCHEDULED_AT || '2026-05-11T06:00:00.000Z');
const INSTAGRAM_URL = 'https://www.instagram.com/leadingtradingest/';
const LINKEDIN_URL = 'https://www.linkedin.com/company/leading-trading-est/';

const newClients = [
  { companyName: 'Al Kindi Hospital B.S.C Closed', email: 'purchase@alkindihospital.com', phone: '17240487' },
  { companyName: 'Al Manal Eye Hospital', email: 'accounts@almanaleyehospital.com', phone: '33986153' },
  { companyName: 'Al Salam Specialist Hospital BSC Closed', email: 'info@alsalam.care', phone: '13101010' },
  { companyName: 'Arab Shipping & Repair Yard (ASRY)', email: 'contact@asry.net', phone: '17671111' },
  { companyName: 'Aspire Medical Center (Dr. Hussain)', email: 'ceo@aspiremedicalcenter.com' },
  { companyName: 'Aster DM Healthcare S.P.C. (Gudabiya)', email: 'rajeev.a@asterclinics.com', phone: '17711811' },
  { companyName: 'BarnaMedical Consultants Center', email: 'admin@barnamed.com', phone: '17550510' },
  { companyName: 'Behbehani Brothers W.L.L', email: 'behbehani@behbehani.com.bh', phone: '17459999' },
  { companyName: 'Dr. Ayman Abouismail', email: 'drayman63@yahoo.com' },
  { companyName: 'Dr. Harraz Pediatric Clinic', email: 'drharraz@gmail.com', phone: '17243334' },
  { companyName: 'Ibn Al Nafees Hospital Co B.S.C. (C)', email: 'accounts@ibnalnafees.com', phone: '17828282' },
  { companyName: 'KIMSHEALTH B.S.C. Closed (Um Ul Hassam)', email: 'kimsbhrn@batelco.com.bh', phone: '17822723' },
  { companyName: 'Shefaa Al Gazera Medical Co. W.L.L', email: 'shahir6@gmail.com', phone: '17288000' },
  { companyName: 'Ibn Al Nafees Hospital Co BSC', name: 'Miss Sithara', email: 'sithara@ibnalnafees.com' },
  { companyName: 'Kims Health B.S.C Closed', name: 'Miss Suparna', email: 'suparna.t.v@royalbhrn.com' },
  { companyName: 'Aster DM Healthcare S.P.C', name: 'Mr. Najam', email: 'nejim.mohamed@asterclinics.com' },
  { companyName: 'University Medical Center', name: 'Miss Nerissa', email: 'nerissa.dayto@uh.bh' },
  { companyName: 'Amana Bahrain W.L.L.', name: 'Miss Manal', email: 'malqattan@amanahealthcare.bh' },
  { companyName: 'American Mission Hospital S.P.C', name: 'Mr. Rafeeq', email: 'purch@amh.org.bh' },
  { companyName: 'Dr. Tariq Hospital S.P.C', name: 'Dear Sir/Madam', email: 'tariplas04@gmail.com' },
  { companyName: 'Dar Al Hayat Medical Center W.L.L.', name: 'Miss Ruby', email: 'dhmcpurchase@daralhayatbh.com' },
];

const missingEmailClients = [
  { companyName: 'Al Noor Establishment for Medical Services', phone: '17592291' },
  { companyName: 'HSE Engineer', phone: '33870828' },
  { companyName: 'Medmen Medical Equipment Co. W.L.L', phone: '17008131' },
  { companyName: 'MEDODENT Medical and Dental Supplies', phone: '17280248' },
  { companyName: 'M.M. Trading WLL', phone: '17874811' },
  { companyName: 'Sabaya Trading Co WLL', phone: '17245111' },
  { companyName: 'Saeed Fakhr Trading Company', phone: '17732280' },
  { companyName: 'Techno Chem Trading', phone: '77077790' },
];

const cleanEmail = (value) => String(value || '').trim().toLowerCase();
const uniqueTags = (...groups) => Array.from(new Set(groups.flat().filter(Boolean)));

const upsertClient = async (row, adminId) => {
  const email = cleanEmail(row.email);
  const existing = email
    ? await Client.findOne({ email })
    : await Client.findOne({ name: row.companyName });

  if (existing) {
    existing.name = row.companyName || existing.name;
    existing.contactPerson = row.name || existing.contactPerson;
    existing.phone = row.phone || existing.phone;
    existing.department = row.department || existing.department;
    existing.notes = existing.notes || 'Imported for social follow campaign scheduling.';
    await existing.save();
    return { updated: true, client: existing };
  }

  const client = await Client.create({
    name: row.companyName,
    contactPerson: row.name || '',
    phone: row.phone || '',
    email,
    department: row.department || '',
    notes: row.email ? `Tagged for ${TAG}.` : 'Missing email; added from supplied customer list.',
    createdBy: adminId,
  });
  return { created: true, client };
};

const upsertMarketingContact = async (row, adminId) => {
  const email = cleanEmail(row.email);
  if (!email) return null;

  const contact = await MarketingContact.findOne({ email });
  if (contact) {
    contact.name = row.name || contact.name;
    contact.companyName = row.companyName || contact.companyName;
    contact.phone = row.phone || contact.phone;
    contact.tags = uniqueTags(contact.tags || [], [TAG, 'scheduled-social-follow']);
    contact.source = contact.source || 'new_client_schedule_import';
    if (!contact.importedBy) contact.importedBy = adminId;
    await contact.save();
    return contact;
  }

  return MarketingContact.create({
    email,
    name: row.name || '',
    companyName: row.companyName,
    phone: row.phone || '',
    tags: [TAG, 'scheduled-social-follow'],
    source: 'new_client_schedule_import',
    consentStatus: 'existing_client',
    importedBy: adminId,
  });
};

const main = async () => {
  if (!mongoUri) throw new Error('Missing MONGO_URI or MONGODB_URI.');
  if (Number.isNaN(SCHEDULED_AT.getTime())) throw new Error('Invalid CAMPAIGN_SCHEDULED_AT.');

  await mongoose.connect(mongoUri);

  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  if (!admin) throw new Error('No admin user found for createdBy/importedBy.');

  const summary = {
    clientsCreated: 0,
    clientsUpdated: 0,
    contactsUpserted: 0,
    campaignCreated: false,
    campaignId: '',
    scheduledAt: SCHEDULED_AT.toISOString(),
    tag: TAG,
  };

  for (const row of [...newClients, ...missingEmailClients]) {
    const result = await upsertClient(row, admin._id);
    if (result.created) summary.clientsCreated += 1;
    if (result.updated) summary.clientsUpdated += 1;
  }

  const contacts = [];
  for (const row of newClients) {
    const contact = await upsertMarketingContact(row, admin._id);
    if (contact && !contact.unsubscribedAt) contacts.push(contact);
  }
  summary.contactsUpserted = contacts.length;

  const existingScheduledCampaign = await MarketingCampaign.findOne({
    type: 'social_follow',
    audienceTag: TAG,
    status: { $in: ['scheduled', 'sending'] },
  });

  if (existingScheduledCampaign) {
    summary.campaignId = String(existingScheduledCampaign._id);
    console.log(JSON.stringify({ ...summary, campaignCreated: false, reason: 'Scheduled campaign already exists.' }, null, 2));
    await mongoose.disconnect();
    return;
  }

  const campaign = await MarketingCampaign.create({
    type: 'social_follow',
    subject: 'A quick note from Leading Trading Est',
    previewText: 'A quick note from Leading Trading Est.',
    instagramUrl: INSTAGRAM_URL,
    linkedinUrl: LINKEDIN_URL,
    audienceTag: TAG,
    createdBy: admin._id,
    status: 'scheduled',
    scheduledAt: SCHEDULED_AT,
    totals: { targeted: contacts.length, sent: 0, skipped: 0, failed: 0 },
    recipients: contacts.map((contact) => ({
      contact: contact._id,
      email: contact.email,
      name: contact.name,
      companyName: contact.companyName,
    })),
  });

  summary.campaignCreated = true;
  summary.campaignId = String(campaign._id);

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
