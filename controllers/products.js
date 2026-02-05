const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/product');
const Category = require('../models/category');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');
const XLSX = require('xlsx');

const router = express.Router();

// ---------- PUBLIC ROUTES ----------

// Get all products (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { category, search, featured, page = 1, limit = 20 } = req.query;
    const filter = { isActive: true };

    if (category) {
      if (mongoose.isValidObjectId(category)) {
        filter.categorySlug = category;
      } else {
        const categoryDoc = await Category.findOne({ slug: category }).select('_id');
        if (!categoryDoc) {
          return res.json({ items: [], total: 0 });
        }
        filter.categorySlug = categoryDoc._id;
      }
    }
    if (search) filter.name = { $regex: search, $options: 'i' };
    if (featured === 'true') filter.featured = true;

    const skip = (Number(page) - 1) * Number(limit);
    const products = await Product.find(filter)
      .select('name brand image images basePrice variants.price variants.type variants.sku variants.name variants.image categorySlug featured')
      .populate('categorySlug', 'name slug')
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await Product.countDocuments(filter);

    res.set('Cache-Control', 'public, max-age=120');
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

// Export products with categories (admin)
router.get('/admin/export', verifyToken, isAdmin, async (req, res) => {
  try {
    const products = await Product.find({})
      .populate('categorySlug', 'name slug')
      .sort('name')
      .lean();
    const categories = await Category.find({})
      .select('name slug')
      .sort('name')
      .lean();

    const productRows = [
      ['Category', 'Product', 'Brand', 'Image', 'Price', 'Description', 'CategorySlug'],
      ...products.map(product => ([
        product.categorySlug?.name || '',
        product.name || '',
        product.brand || '',
        product.image || '',
        product.basePrice ?? '',
        product.description || '',
        product.categorySlug?.slug || '',
      ])),
    ];

    const categoryRows = [
      ['Category', 'CategorySlug'],
      ...categories.map(category => ([
        category.name || '',
        category.slug || '',
      ])),
    ];

    const workbook = XLSX.utils.book_new();
    const productSheet = XLSX.utils.aoa_to_sheet(productRows);
    const categorySheet = XLSX.utils.aoa_to_sheet(categoryRows);

    productSheet['!cols'] = [
      { wch: 32 },
      { wch: 44 },
      { wch: 24 },
      { wch: 32 },
      { wch: 12 },
      { wch: 44 },
      { wch: 32 },
    ];
    categorySheet['!cols'] = [{ wch: 32 }, { wch: 32 }];

    XLSX.utils.book_append_sheet(workbook, productSheet, 'Products');
    XLSX.utils.book_append_sheet(workbook, categorySheet, 'Categories');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="products-categories.xlsx"');
    res.status(200).send(buffer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Bulk import products (admin)
router.post('/import', verifyToken, isAdmin, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const prepared = items
    .map(item => ({
      name: String(item.name || '').trim(),
      categorySlug: item.categorySlug,
      description: item.description,
      brand: item.brand,
      sku: item.sku,
      image: item.image,
      basePrice: item.basePrice,
      featured: item.featured,
      isActive: item.isActive,
    }))
    .filter(item => item.name && item.categorySlug);

  try {
    if (!items.length) {
      return res.status(400).json({ message: 'No items provided' });
    }
    if (!prepared.length) {
      return res.status(400).json({ message: 'No valid items to import' });
    }

    const hasValue = (value) => String(value || '').trim().length > 0;
    const hasNumber = (value) => value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value));
    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const ops = prepared.map(item => {
      const update = {
        name: item.name,
        categorySlug: item.categorySlug,
      };
      if (hasValue(item.description)) update.description = item.description;
      if (hasValue(item.brand)) update.brand = item.brand;
      if (hasValue(item.sku)) update.sku = item.sku;
      if (hasValue(item.image)) update.image = item.image;
      if (hasNumber(item.basePrice)) update.basePrice = Number(item.basePrice);
      if (item.featured !== undefined) update.featured = !!item.featured;
      if (item.isActive !== undefined) update.isActive = item.isActive !== false;

      return {
        updateOne: {
          filter: {
            categorySlug: item.categorySlug,
            name: { $regex: `^${escapeRegex(item.name.trim())}$`, $options: 'i' },
          },
          update: { $set: update },
          upsert: true,
        },
      };
    });

    const result = await Product.bulkWrite(ops, { ordered: false });
    return res.status(200).json({
      inserted: result.upsertedCount || 0,
      updated: result.modifiedCount || 0,
      matched: result.matchedCount || 0,
      attempted: prepared.length,
    });
  } catch (err) {
    if (err?.writeErrors?.length) {
      return res.status(200).json({
        inserted: err.result?.nInserted || 0,
        attempted: prepared.length,
        errors: err.writeErrors.map(e => e.errmsg),
      });
    }
    return res.status(400).json({ message: err.message });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('categorySlug').lean();
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
