const express = require('express');
const mongoose = require('mongoose');
const Category = require('../models/category');
const Product = require('../models/product');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');

const router = express.Router();

// PUBLIC
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find()
      .select('name slug description image parent sortOrder createdAt')
      .populate('parent', 'name slug')
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    res.set('Cache-Control', 'public, max-age=120');
    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
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
      category = await Category.findById(value).populate('parent', 'name slug').lean();
    }
    if (!category) {
      category = await Category.findOne({ slug: value }).populate('parent', 'name slug').lean();
    }
    if (!category) return res.status(404).json({ message: 'Not found' });
    const children = await Category.find({ parent: category._id })
      .select('name slug description image parent sortOrder createdAt')
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    res.json({ ...category, children });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const normalizeParent = async (value, currentId) => {
  if (!value) return null;
  if (!mongoose.isValidObjectId(value)) {
    throw new Error('Invalid parent category');
  }
  if (currentId && String(currentId) === String(value)) {
    throw new Error('A category cannot be its own parent');
  }
  const parent = await Category.findById(value).select('_id parent');
  if (!parent) {
    throw new Error('Parent category not found');
  }
  if (currentId && parent.parent && String(parent.parent) === String(currentId)) {
    throw new Error('Nested category loops are not allowed');
  }
  return parent._id;
};

// ADMIN
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (!payload.slug && payload.name) {
      const base = slugify(payload.name);
      payload.slug = await buildUniqueSlug(base);
    }
    payload.parent = await normalizeParent(payload.parent);
    payload.sortOrder = Number(payload.sortOrder || 0);
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
    payload.parent = await normalizeParent(payload.parent, req.params.id);
    payload.sortOrder = Number(payload.sortOrder || 0);
    const category = await Category.findByIdAndUpdate(req.params.id, payload, {
      new: true,
    });
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json(category);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const childrenCount = await Category.countDocuments({ parent: req.params.id });
    if (childrenCount > 0) {
      return res.status(400).json({ message: 'Remove or reassign subcategories before deleting this category' });
    }
    const productCount = await Product.countDocuments({ categorySlug: req.params.id });
    if (productCount > 0) {
      return res.status(400).json({ message: 'Reassign products before deleting this category' });
    }
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
