const express = require('express');
const Product = require('../models/product');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');

const router = express.Router();

// ---------- PUBLIC ROUTES ----------

// Get all products (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { category, search, featured, page = 1, limit = 20 } = req.query;
    const filter = { isActive: true };

    if (category) filter.categorySlug = category;
    if (search) filter.name = { $regex: search, $options: 'i' };
    if (featured === 'true') filter.featured = true;

    const skip = (Number(page) - 1) * Number(limit);
    const products = await Product.find(filter)
      .populate('categorySlug')
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await Product.countDocuments(filter);

    res.json({ items: products, total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------- ADMIN ROUTES ----------

// Get all products (admin, includes inactive)
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const { search } = req.query;
    const filter = {};
    if (search) filter.name = { $regex: search, $options: 'i' };
    const products = await Product.find(filter).populate('categorySlug').lean();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('categorySlug');
    if (!product) return res.status(404).json({ message: 'Not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create product
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update product
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete product
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
