const express = require('express');
const mongoose = require('mongoose');
const Category = require('../models/category');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');

const router = express.Router();

// PUBLIC
router.get('/', async (req, res) => {
  const categories = await Category.find()
    .select('name slug description image')
    .sort('name')
    .lean();
  res.set('Cache-Control', 'public, max-age=120');
  res.json(categories);
});

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const buildUniqueSlug = async (base, excludeId) => {
  let slug = base;
  let counter = 2;
  // ensure uniqueness while allowing the same doc to keep its slug
  while (await Category.findOne({ slug, _id: { $ne: excludeId } })) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
};

// Get single category (by id or slug)
router.get('/:id', async (req, res) => {
  try {
    const value = req.params.id;
    let category = null;
    if (mongoose.isValidObjectId(value)) {
      category = await Category.findById(value).lean();
    }
    if (!category) {
      category = await Category.findOne({ slug: value }).lean();
    }
    if (!category) return res.status(404).json({ message: 'Not found' });
    res.json(category);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADMIN
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (!payload.slug && payload.name) {
      const base = slugify(payload.name);
      payload.slug = await buildUniqueSlug(base);
    }
    const category = await Category.create(payload);
    res.status(201).json(category);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (!payload.slug && payload.name) {
      const base = slugify(payload.name);
      payload.slug = await buildUniqueSlug(base, req.params.id);
    }
    const category = await Category.findByIdAndUpdate(req.params.id, payload, {
      new: true,
    });
    res.json(category);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
