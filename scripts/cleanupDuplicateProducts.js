#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/product');

const apply = process.argv.includes('--apply');

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const hasValue = (value) => String(value || '').trim().length > 0;

const isProtected = (doc) =>
  hasValue(doc.brand) ||
  hasValue(doc.image) ||
  (Array.isArray(doc.images) && doc.images.length > 0);

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const products = await Product.find({})
      .select('name categorySlug createdAt brand image images')
      .lean();

    const groups = new Map();
    for (const product of products) {
      const nameKey = normalize(product.name);
      const categoryKey = String(product.categorySlug || '');
      if (!nameKey || !categoryKey) continue;
      const key = `${categoryKey}::${nameKey}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(product);
    }

    let groupsWithDuplicates = 0;
    let toDelete = [];
    let toKeep = [];

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      groupsWithDuplicates += 1;
      const sorted = [...group].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const protectedItems = sorted.filter(isProtected);
      const keeper = protectedItems.length ? protectedItems[0] : sorted[0];
      toKeep.push(keeper);
      for (const item of sorted) {
        if (String(item._id) === String(keeper._id)) continue;
        toDelete.push(item);
      }
    }

    if (!apply) {
      console.log(`[DRY RUN] Duplicate groups: ${groupsWithDuplicates}`);
      console.log(`[DRY RUN] Would delete: ${toDelete.length}`);
      console.log(`[DRY RUN] Would keep (one per group): ${toKeep.length}`);
      process.exit(0);
    }

    if (!toDelete.length) {
      console.log('No duplicates to delete.');
      process.exit(0);
    }

    const deleteIds = toDelete.map(item => item._id);
    const result = await Product.deleteMany({ _id: { $in: deleteIds } });
    console.log(`Deleted ${result.deletedCount} duplicate products.`);
    console.log(`Groups cleaned: ${groupsWithDuplicates}`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
