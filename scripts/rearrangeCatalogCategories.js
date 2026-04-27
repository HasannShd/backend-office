#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/category');
const Product = require('../models/product');

const apply = process.argv.includes('--apply');

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const dentalSubcategories = [
  {
    name: 'Dental Endodontics',
    sortOrder: 91,
    description: 'Endodontic files, reamers, paper points, gutta-percha products, broaches, pluggers, spreaders, and root-canal preparation accessories.',
  },
  {
    name: 'Dental Burs & Finishing',
    sortOrder: 92,
    description: 'Dental burs and finishing products used for tooth preparation, shaping, contouring, polishing, and restorative finishing workflows.',
  },
  {
    name: 'Dental Disposables & Chairside',
    sortOrder: 93,
    description: 'Dental chairside disposable and accessory products including syringe tips, ejectors, aspirator tips, needles, applicators, sleeves, and appliance storage items.',
  },
  {
    name: 'Dental Restorative & Isolation',
    sortOrder: 94,
    description: 'Dental restorative and isolation products including matrix bands, articulating paper, dental dams, and mixing pads for chairside treatment support.',
  },
];

const productMoves = new Map([
  // Dental Endodontics
  ['Absorbent Paper point', 'Dental Endodontics'],
  ['Barbed Broaches with Plastic Handle', 'Dental Endodontics'],
  ['Gate Drills & Pesso Reamers', 'Dental Endodontics'],
  ['Gutta Percha Cutter', 'Dental Endodontics'],
  ['Gutta Percha Points', 'Dental Endodontics'],
  ['H-Files-Stainless Steel', 'Dental Endodontics'],
  ['INO-Shaper', 'Dental Endodontics'],
  ['K- Files-Stainless Steel', 'Dental Endodontics'],
  ['Paste Carriers ( Lentula )', 'Dental Endodontics'],
  ['Reamers-Stainless Steel', 'Dental Endodontics'],
  ['Recip-One Files', 'Dental Endodontics'],
  ['Retreatment Files', 'Dental Endodontics'],
  ['Stainless Steel Pluggers', 'Dental Endodontics'],
  ['Stainless Steel Spreaders', 'Dental Endodontics'],
  ['Sup Taper Files Aurora', 'Dental Endodontics'],
  ['Sup-Taper Files Hand Use', 'Dental Endodontics'],
  ['Super Flexi Files', 'Dental Endodontics'],

  // Dental Burs & Finishing
  ['Carbide Burs FG', 'Dental Burs & Finishing'],
  ['Diamond Burs FG', 'Dental Burs & Finishing'],
  ['Polishing Disc', 'Dental Burs & Finishing'],

  // Dental Disposables & Chairside
  ['Air Water Syringe Tips', 'Dental Disposables & Chairside'],
  ['Dental needle', 'Dental Disposables & Chairside'],
  ['Denture Box', 'Dental Disposables & Chairside'],
  ['Head Rest Sleeve', 'Dental Disposables & Chairside'],
  ['Microbrush applicator ', 'Dental Disposables & Chairside'],
  ['Saliva Ejector', 'Dental Disposables & Chairside'],
  ['Surgical Aspirator Tips', 'Dental Disposables & Chairside'],

  // Dental Restorative & Isolation
  ['Articulating Paper Straight', 'Dental Restorative & Isolation'],
  ['Dental Matrix Bands', 'Dental Restorative & Isolation'],
  ['Latex dental dam', 'Dental Restorative & Isolation'],
  ['Poly Coated Mixing Pad', 'Dental Restorative & Isolation'],

  // Non-Dental cleanup
  ['Air compressing nebulizer machine', 'ANESTHESIA & RESPIRATORY'],
  ['Closed wound drainage reservoir', 'Wound Care, Dressing & First Aid'],
  ['Suction Cath.', 'ANESTHESIA & RESPIRATORY'],
]);

const findCategoryByName = async (name) =>
  Category.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });

const ensureCategory = async ({ name, parent, description, sortOrder }) => {
  let category = await findCategoryByName(name);
  const update = {
    name,
    slug: slugify(name),
    parent: parent?._id || null,
    description,
    sortOrder,
  };

  if (!category) {
    if (apply) {
      category = await Category.create(update);
    }
    return {
      category: category || { _id: `dry-${slugify(name)}`, name },
      action: 'create',
      update,
    };
  }

  const needsUpdate =
    normalize(category.name) !== normalize(name) ||
    String(category.parent || '') !== String(update.parent || '') ||
    String(category.description || '') !== String(description || '') ||
    Number(category.sortOrder || 0) !== Number(sortOrder || 0) ||
    category.slug !== update.slug;

  if (apply && needsUpdate) {
    category = await Category.findByIdAndUpdate(category._id, update, { new: true });
  }

  return {
    category,
    action: needsUpdate ? 'update' : 'keep',
    update,
  };
};

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('Missing MONGO_URI or MONGODB_URI');
  await mongoose.connect(mongoUri);

  const dental = await findCategoryByName('Dental');
  if (!dental) throw new Error('Dental category not found');

  const categoryResults = [];
  const categoryByName = new Map();
  categoryByName.set(normalize(dental.name), dental);

  for (const entry of dentalSubcategories) {
    const result = await ensureCategory({ ...entry, parent: dental });
    categoryResults.push({ name: entry.name, action: result.action });
    categoryByName.set(normalize(entry.name), result.category);
  }

  const allTargetNames = Array.from(new Set(productMoves.values()));
  for (const name of allTargetNames) {
    if (categoryByName.has(normalize(name))) continue;
    const category = await findCategoryByName(name);
    if (!category) throw new Error(`Target category not found: ${name}`);
    categoryByName.set(normalize(name), category);
  }

  const moveResults = [];
  for (const [productName, categoryName] of productMoves.entries()) {
    const products = await Product.find({ name: productName }).populate('categorySlug', 'name');
    if (!products.length) {
      moveResults.push({ productName, categoryName, action: 'missing-product' });
      continue;
    }

    const target = categoryByName.get(normalize(categoryName));
    if (!target?._id) {
      moveResults.push({ productName, categoryName, action: 'missing-category' });
      continue;
    }

    for (const product of products) {
      const currentName = product.categorySlug?.name || '-';
      const alreadyThere = String(product.categorySlug?._id || product.categorySlug || '') === String(target._id);
      if (apply && !alreadyThere) {
        product.categorySlug = target._id;
        await product.save();
      }
      moveResults.push({
        productName,
        from: currentName,
        to: target.name,
        action: alreadyThere ? 'keep' : 'move',
      });
    }
  }

  const counts = await Product.aggregate([
    { $group: { _id: '$categorySlug', count: { $sum: 1 } } },
    {
      $lookup: {
        from: 'categories',
        localField: '_id',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: '$category' },
    {
      $project: {
        _id: 0,
        category: '$category.name',
        count: 1,
      },
    },
    { $sort: { category: 1 } },
  ]);

  console.log(apply ? '[APPLY]' : '[DRY RUN]');
  console.log(`Category changes: ${JSON.stringify(categoryResults, null, 2)}`);
  console.log(`Product move rows: ${moveResults.length}`);
  moveResults.forEach((entry) => {
    console.log(`${entry.action.toUpperCase()}: ${entry.productName} :: ${entry.from || '-'} -> ${entry.to || entry.categoryName}`);
  });
  console.log('Counts after plan/current state:');
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
