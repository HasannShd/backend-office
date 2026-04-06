#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/product');
require('../models/category');

const apply = process.argv.includes('--apply');

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const renamePairs = [
  ['Air cimpressing nebulizer machine', 'Air Compressing Nebulizer Machine'],
  ['Machenical Baby scale', 'Mechanical Baby Scale'],
  ['Foldway strecher two parts and four parts', 'Foldable Stretcher Two Parts and Four Parts'],
  ['Curvical collars', 'Cervical Collars'],
  ['Scalpal blades', 'Scalpel Blades'],
  ['Dressind set', 'Dressing Set'],
  ['Safety Goggless', 'Safety Goggles'],
  ['Safety Googles', 'Safety Goggles'],
  ['Yankuer Handle', 'Yankauer Handle'],
  ['Reuseable laryngeal masks', 'Reusable Laryngeal Masks'],
  ['Disp. Laryngeal masks', 'Disposable Laryngeal Masks'],
  ['Alcohal swab pad', 'Alcohol Swab Pad'],
  ['Microporoes surgical tape non-woven', 'Microporous Surgical Tape Non-Woven'],
  ['Steam sterilization indicatot tape', 'Steam Sterilization Indicator Tape'],
  ['Flat sterilization pouchs', 'Flat Sterilization Pouches'],
  ['Ultrasoung transmission coupling gel', 'Ultrasound Transmission Coupling Gel'],
  ['Cotton Role Dispenser', 'Cotton Roll Dispenser'],
];

const renameMap = new Map(renamePairs.map(([from, to]) => [normalize(from), to]));

async function run() {
  if (!process.env.MONGO_URI && !process.env.MONGODB_URI) {
    throw new Error('Missing MONGO_URI or MONGODB_URI');
  }

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const products = await Product.find({})
    .select('_id name categorySlug')
    .populate('categorySlug', 'name')
    .sort({ name: 1 })
    .lean();

  const planned = [];
  const ops = [];

  for (const product of products) {
    const nextName = renameMap.get(normalize(product.name));
    if (!nextName || nextName === product.name) continue;

    planned.push({
      id: String(product._id),
      from: product.name,
      to: nextName,
      category: product.categorySlug?.name || '-',
    });

    if (apply) {
      ops.push({
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { name: nextName } },
        },
      });
    }
  }

  if (apply && ops.length) {
    await Product.bulkWrite(ops, { ordered: false });
  }

  console.log(apply ? '[APPLY]' : '[DRY RUN]');
  console.log(`Products to rename: ${planned.length}`);
  planned.forEach((entry) => {
    console.log(`- ${entry.from} -> ${entry.to} [${entry.category}]`);
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
