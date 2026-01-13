const express = require('express');
const Category = require('../models/category');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');

const router = express.Router();

// PUBLIC
router.get('/', async (req, res) => {
  const categories = await Category.find().sort('name');
  res.json(categories);
});

// Get single category
router.get('/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Not found' });
    res.json(category);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADMIN
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const category = await Category.create(req.body);
    res.status(201).json(category);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
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
