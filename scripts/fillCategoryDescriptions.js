#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/category');

const apply = process.argv.includes('--apply');

const descriptionMap = new Map([
  ['Medical Equipment', 'Essential clinical and diagnostic equipment for hospitals, clinics, practices, and professional care environments.'],
  ['Anesthesia & Respiratory', 'Respiratory care, airway management, and anesthesia-related products designed for safe clinical support and patient care.'],
  ['Laboratory', 'Laboratory and diagnostic support products for sample handling, testing, recording, and routine clinical workflows.'],
  ['Surgical Instruments', 'Precision instruments and procedure-support tools used across examination, minor procedures, and surgical settings.'],
  ['Consumables & Disposables', 'High-rotation everyday consumables and disposable products that support infection control, patient care, and routine medical use.'],
  ['Orthopedic & Rehabilitation', 'Support, stabilization, casting, and rehabilitation products for recovery, mobility, and musculoskeletal care.'],
  ['Hospital Furniture & Utilities', 'Facility support items, transport solutions, and utility equipment used in patient handling, storage, and daily operations.'],
  ['Urology', 'Urology and catheter-related products for drainage, urine collection, and patient management in clinical settings.'],
  ['Dental', 'Dental instruments, consumables, and specialist products for restorative, endodontic, and general practice use.'],
  ['Industrial & Safety', 'Safety, sterilization, waste-handling, and operational products for controlled environments and workplace protection.'],
  ['Lab Equipment', 'Equipment used in laboratory, diagnostic, and monitoring workflows to support routine testing and clinical assessment.'],
  ['Lab Consumables', 'Disposable and recurring laboratory-use items for testing, sampling, and day-to-day diagnostic processes.'],
  ['Diagnostics & Recording', 'Recording media, gels, and related accessories used in diagnostic monitoring and examination procedures.'],
  ['Examination & General Disposable', 'General-use disposable items commonly used in examination rooms, patient handling, and routine clinical care.'],
  ['Injection & IV Disposable', 'Injection, infusion, and vascular-access disposables used in medication delivery, fluid administration, and clinical procedures.'],
  ['Wound Care, Dressing & First Aid', 'Dressings, tapes, gauze, and first-aid products used for wound protection, recovery, and everyday clinical treatment.'],
  ['PPE & Non-Woven Disposable', 'Protective apparel and non-woven disposable items designed to support hygiene, infection control, and barrier protection.'],
  ['Sutures', 'Suture materials and closure products for surgical, procedural, and wound-management applications.'],
]);

async function run() {
  if (!process.env.MONGO_URI && !process.env.MONGODB_URI) {
    throw new Error('Missing MONGO_URI or MONGODB_URI');
  }

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const categories = await Category.find({})
    .select('name description')
    .sort({ name: 1 })
    .lean();

  const planned = [];
  const ops = [];

  for (const category of categories) {
    const nextDescription = descriptionMap.get(category.name);
    if (!nextDescription) continue;
    if ((category.description || '').trim() === nextDescription) continue;

    planned.push({
      id: String(category._id),
      name: category.name,
      before: category.description || '',
      after: nextDescription,
    });

    if (apply) {
      ops.push({
        updateOne: {
          filter: { _id: category._id },
          update: { $set: { description: nextDescription } },
        },
      });
    }
  }

  if (apply && ops.length) {
    await Category.bulkWrite(ops, { ordered: false });
  }

  console.log(apply ? '[APPLY]' : '[DRY RUN]');
  console.log(`Categories to update: ${planned.length}`);
  planned.forEach((entry) => {
    console.log(`- ${entry.name}`);
    console.log(`  before: ${entry.before || '(empty)'}`);
    console.log(`  after:  ${entry.after}`);
  });

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors on failure path
  }
  process.exit(1);
});
