#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/category');
const Product = require('../models/product');

const apply = process.argv.includes('--apply');

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const subcategories = [
  {
    name: 'Examination & General Disposable',
    sortOrder: 51,
    description: 'General examination disposables including kidney dishes, razors, patient ID bands, tongue depressors, and wooden applicators.',
    products: [
      'Disposable Kidney Dish',
      'Disposable Razors',
      'Patient ID Band',
      'Tongue Depressor Sterile/Non Sterile',
      'Wooden Applicator Sterile/Non Sterile',
    ],
  },
  {
    name: 'Injection & IV Disposable',
    sortOrder: 52,
    description: 'Syringes, needles, IV sets, cannulas, stopcocks, tourniquets, and injection or infusion accessories.',
    products: [
      '3-Way Stopcock',
      '3-Way Stopcock with Extension',
      'Disposable Hypodermic Needle',
      'Disposable IV Infusion Set',
      'Disposable Pediatric Burette IV Set',
      'Disposable Syringes',
      'Epidural minipack/kit',
      'Heparin cap/IV stopper',
      'I.V cannula',
      'Scalp Vein Set',
      'Spinal needle',
      'Tourniquets',
    ],
  },
  {
    name: 'PPE Masks & Shields',
    sortOrder: 53,
    description: 'Face masks, N95 masks, dust masks, and eye-shield masks for staff and patient protection.',
    products: [
      'Dust proof face mask',
      'Face Mask',
      'Face Mask with Eye Shield',
      'N95 mask',
    ],
  },
  {
    name: 'PPE Gloves',
    sortOrder: 54,
    description: 'Examination, surgical, nitrile, vinyl, PVC, latex, and cotton gloves for protective clinical handling.',
    products: [
      'Cotton Gloves',
      'Latex Surgical Gloves Powdered/Powder Free',
      'Latex examination gloves',
      'Nitrile gloves',
      'Vinyl / PVC gloves',
    ],
  },
  {
    name: 'Gowns, Drapes & Covers',
    sortOrder: 55,
    description: 'Caps, gowns, aprons, shoe covers, bed sheets, underpads, and non-woven protective covers.',
    products: [
      'Doctor / Surgeon Cap',
      'Isolation gowns',
      'Non-woven bed sheet',
      'PE Apron',
      'Patient gown',
      'SMS Surgeon Gown',
      'Shoe cover',
      'Underpad 60 x 90',
    ],
  },
  {
    name: 'Wound Dressings & Gauze',
    sortOrder: 56,
    description: 'Gauze, cotton rolls, dressing sets, wound dressings, laparotomy sponges, and wound-contact dressing materials.',
    products: [
      'Closed wound drainage reservoir',
      'Cotton Roll',
      'Dressing Set',
      'Gauze Rolls',
      'Gauze swab / Gauze sponge',
      'Gauze/Cotton Balls',
      'Laparotomy sponge',
      'PU transparent wound dressing',
      'Spunlace Non-woven Dressing Roll',
      'Sterile Gauze Swab',
      'Wound Dressings',
    ],
  },
  {
    name: 'Medical Tapes & Bandages',
    sortOrder: 57,
    description: 'Clinical tapes and related bandage items used for securement, dressing support, and routine care.',
    products: [
      'Elastic Cloth Adhesive Tape',
      'Microporous Surgical Tape Non-Woven',
      'Transparent surgical tape PE',
    ],
  },
  {
    name: 'Skin Prep & First Aid',
    sortOrder: 58,
    description: 'Alcohol swabs, wound plasters, ice packs, and quick first-aid accessories for routine treatment support.',
    products: [
      'Alcohol Swab Pad',
      'First Aid Adhesive Bandages / Wound Plaster',
      'Instant Ice pack',
    ],
  },
  {
    name: 'Sutures',
    sortOrder: 59,
    description: 'Absorbable and non-absorbable sutures for wound closure, tissue approximation, and surgical procedures.',
    products: [
      'Daclon Nylon',
      'Polypropylene Blue',
      'Silk Braided',
      'Surgicryl 910',
      'Surgicryl Monofast',
      'Surgicryl Monofilament',
      'Surgicryl PGA',
      'Surgicryl Rapid',
    ],
  },
];

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('Missing MONGO_URI or MONGODB_URI');
  await mongoose.connect(mongoUri);

  const parent = await Category.findOne({ name: 'Consumables & Disposables', parent: null });
  if (!parent) throw new Error('Consumables & Disposables root category not found');

  const categoryResults = [];
  const categoryMap = new Map();

  for (const entry of subcategories) {
    let category = await Category.findOne({ name: entry.name, parent: parent._id });
    const update = {
      name: entry.name,
      slug: slugify(entry.name),
      parent: parent._id,
      sortOrder: entry.sortOrder,
      description: entry.description,
    };

    if (!category) {
      if (apply) category = await Category.create(update);
      categoryResults.push({ name: entry.name, action: 'create' });
      categoryMap.set(entry.name, category || update);
      continue;
    }

    const needsUpdate =
      category.slug !== update.slug ||
      Number(category.sortOrder || 0) !== Number(update.sortOrder) ||
      String(category.description || '') !== String(update.description || '');

    if (apply && needsUpdate) {
      category = await Category.findByIdAndUpdate(category._id, update, { new: true });
    }

    categoryResults.push({ name: entry.name, action: needsUpdate ? 'update' : 'keep' });
    categoryMap.set(entry.name, category);
  }

  const moveResults = [];
  for (const entry of subcategories) {
    const category = categoryMap.get(entry.name);
    if (!category?._id) continue;

    for (const [index, productName] of entry.products.entries()) {
      const product = await Product.findOne({ name: productName, isActive: { $ne: false } });
      if (!product) {
        moveResults.push({ product: productName, to: entry.name, action: 'missing-product' });
        continue;
      }

      const nextSortOrder = (entry.sortOrder * 1000) + index + 1;
      const needsMove = String(product.categorySlug || '') !== String(category._id);
      const needsSort = product.sortOrder !== nextSortOrder;

      if (apply && (needsMove || needsSort)) {
        product.categorySlug = category._id;
        product.sortOrder = nextSortOrder;
        await product.save();
      }

      moveResults.push({
        product: productName,
        to: entry.name,
        action: needsMove || needsSort ? 'move' : 'keep',
      });
    }
  }

  const counts = await Product.aggregate([
    { $match: { isActive: { $ne: false } } },
    { $group: { _id: '$categorySlug', count: { $sum: 1 } } },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
    { $unwind: '$category' },
    { $lookup: { from: 'categories', localField: 'category.parent', foreignField: '_id', as: 'parentDoc' } },
    { $unwind: { path: '$parentDoc', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        category: '$category.name',
        parent: '$parentDoc.name',
        sortOrder: '$category.sortOrder',
        count: 1,
      },
    },
    { $sort: { sortOrder: 1, category: 1 } },
  ]);

  console.log(apply ? '[APPLY]' : '[DRY RUN]');
  console.log(`Subcategories checked: ${categoryResults.length}`);
  console.log(`Category changes: ${categoryResults.filter((entry) => entry.action !== 'keep').length}`);
  console.log(`Product changes: ${moveResults.filter((entry) => entry.action === 'move').length}`);
  console.log('Move issues:', moveResults.filter((entry) => entry.action === 'missing-product'));
  console.log('Counts after restore/current state:');
  console.log(JSON.stringify(counts, null, 2));

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
