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

const ROOT_CATEGORY_ORDER = new Map([
  ['medical equipment', 10],
  ['anesthesia & respiratory', 20],
  ['laboratory', 30],
  ['cssd', 35],
  ['surgical instruments', 40],
  ['consumables & disposables', 50],
  ['orthopedic & rehabilitation', 60],
  ['hospital furniture & utilities', 70],
  ['urology', 80],
  ['dental', 90],
  ['industrial & safety', 100],
]);

const findRootCategories = async () =>
  Category.find({ $or: [{ parent: null }, { parent: { $exists: false } }] })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('Missing MONGO_URI or MONGODB_URI');
  await mongoose.connect(mongoUri);

  const rootCategories = await findRootCategories();
  const rootById = new Map(rootCategories.map((category) => [String(category._id), category]));
  const rootByName = new Map(rootCategories.map((category) => [normalize(category.name), category]));
  const childCategories = await Category.find({ parent: { $ne: null } }).sort({ sortOrder: 1, name: 1 }).lean();

  const moveResults = [];
  for (const child of childCategories) {
    const root = rootById.get(String(child.parent)) || rootByName.get(normalize(child.parent?.name || ''));
    if (!root?._id) {
      moveResults.push({ category: child.name, action: 'missing-root' });
      continue;
    }

    const products = await Product.find({ categorySlug: child._id }).sort({ sortOrder: 1, name: 1 });
    for (const product of products) {
      if (apply) {
        product.categorySlug = root._id;
        await product.save();
      }
      moveResults.push({
        product: product.name,
        from: child.name,
        to: root.name,
        action: 'move',
      });
    }
  }

  const activeProducts = await Product.find({ isActive: { $ne: false } })
    .populate('categorySlug', 'name sortOrder')
    .sort({ featured: -1, name: 1 });

  const sortResults = [];
  for (const [index, product] of activeProducts.entries()) {
    const categoryName = normalize(product.categorySlug?.name || '');
    const rootSort = ROOT_CATEGORY_ORDER.get(categoryName) || Number(product.categorySlug?.sortOrder || 999);
    const nextSortOrder = (rootSort * 1000) + index + 1;
    const needsUpdate = product.sortOrder !== nextSortOrder;
    if (apply && needsUpdate) {
      product.sortOrder = nextSortOrder;
      await product.save();
    }
    sortResults.push({ product: product.name, sortOrder: nextSortOrder, action: needsUpdate ? 'update' : 'keep' });
  }

  const deleteResults = [];
  for (const child of childCategories) {
    const remainingProducts = await Product.countDocuments({ categorySlug: child._id });
    const remainingChildren = await Category.countDocuments({ parent: child._id });
    if (remainingProducts || remainingChildren) {
      deleteResults.push({ category: child.name, action: 'keep', remainingProducts, remainingChildren });
      continue;
    }

    if (apply) {
      await Category.findByIdAndDelete(child._id);
    }
    deleteResults.push({ category: child.name, action: 'delete' });
  }

  const counts = await Product.aggregate([
    { $match: { isActive: { $ne: false } } },
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
        sortOrder: '$category.sortOrder',
        count: 1,
      },
    },
    { $sort: { sortOrder: 1, category: 1 } },
  ]);

  console.log(apply ? '[APPLY]' : '[DRY RUN]');
  console.log(`Products to move: ${moveResults.filter((entry) => entry.action === 'move').length}`);
  console.log(`Products to re-sort: ${sortResults.filter((entry) => entry.action === 'update').length}`);
  console.log(`Subcategories to delete: ${deleteResults.filter((entry) => entry.action === 'delete').length}`);
  console.log('Move issues:', moveResults.filter((entry) => entry.action !== 'move'));
  console.log('Counts after flattening/current state:');
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
