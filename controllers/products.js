const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/product');
const Category = require('../models/category');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');
const ExcelJS = require('exceljs');

const router = express.Router();

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSpreadsheetBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (['true', '1', 'yes', 'y', 'active', 'featured', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'inactive', 'off'].includes(normalized)) return false;
  return undefined;
};

const normalizeReviewAction = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (['remove', 'delete', 'deactivate', 'archive', 'inactive'].includes(normalized)) return 'deactivate';
  if (['add', 'new', 'create'].includes(normalized)) return 'add';
  if (['update', 'edit', 'change'].includes(normalized)) return 'update';
  if (['keep', 'leave', 'ok'].includes(normalized)) return 'keep';
  if (['skip', 'ignore'].includes(normalized)) return 'skip';
  return normalized;
};

const formatIsoDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
};

const collectDescendantCategoryIds = async (categoryId) => {
  const rootId = String(categoryId);
  const allCategories = await Category.find({})
    .select('_id parent')
    .lean();

  const descendants = new Set([rootId]);
  let changed = true;

  while (changed) {
    changed = false;
    allCategories.forEach((category) => {
      if (!category.parent) return;
      const parentId = String(category.parent);
      const currentId = String(category._id);
      if (descendants.has(parentId) && !descendants.has(currentId)) {
        descendants.add(currentId);
        changed = true;
      }
    });
  }

  return Array.from(descendants);
};

// ---------- PUBLIC ROUTES ----------

// Get all products (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { category, search, featured, page = 1, limit = 20 } = req.query;
    const filter = { isActive: true };
    const pageNumber = Math.max(Number(page) || 1, 1);
    const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 200);

    if (category) {
      if (mongoose.isValidObjectId(category)) {
        const categoryIds = await collectDescendantCategoryIds(category);
        filter.categorySlug = { $in: categoryIds };
      } else {
        const categoryDoc = await Category.findOne({ slug: category }).select('_id');
        if (!categoryDoc) {
          return res.json({ items: [], total: 0 });
        }
        const categoryIds = await collectDescendantCategoryIds(categoryDoc._id);
        filter.categorySlug = { $in: categoryIds };
      }
    }
    if (search) {
      const pattern = escapeRegex(search).slice(0, 80);
      filter.$or = [
        { name: { $regex: pattern, $options: 'i' } },
        { brand: { $regex: pattern, $options: 'i' } },
        { sku: { $regex: pattern, $options: 'i' } },
      ];
    }
    if (featured === 'true') filter.featured = true;

    const skip = (pageNumber - 1) * limitNumber;
    const [products, total] = await Promise.all([
      Product.find(filter)
        .select('name brand image images basePrice variants.price variants.type variants.sku variants.name variants.image categorySlug featured')
        .populate({
          path: 'categorySlug',
          select: 'name slug parent',
          populate: { path: 'parent', select: 'name slug' },
        })
        .sort({ sortOrder: 1, featured: -1, name: 1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Product.countDocuments(filter),
    ]);

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
    const products = await Product.find(filter)
      .populate({
        path: 'categorySlug',
        populate: { path: 'parent', select: 'name slug' },
      })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Export products with categories (admin)
router.get('/admin/export', verifyToken, isAdmin, async (req, res) => {
  try {
    const products = await Product.find({})
      .populate({
        path: 'categorySlug',
        select: 'name slug parent',
        populate: { path: 'parent', select: 'name slug' },
      })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    const categories = await Category.find({})
      .select('name slug parent sortOrder')
      .populate('parent', 'name slug')
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    const instructionsSheet = workbook.addWorksheet('Instructions');
    const productSheet = workbook.addWorksheet('Products');
    const categorySheet = workbook.addWorksheet('Categories');

    instructionsSheet.columns = [
      { header: 'Field', key: 'field', width: 24 },
      { header: 'How to use it', key: 'guidance', width: 96 },
    ];
    instructionsSheet.addRows([
      {
        field: 'ReviewAction',
        guidance: 'Leave blank to keep as-is. Use add for new items, update for changed items, or remove/deactivate to turn an item inactive without deleting history.',
      },
      {
        field: 'ReviewNotes',
        guidance: 'Optional internal note for the reviewer. This column is ignored on import.',
      },
      {
        field: 'Import format',
        guidance: 'Review in Excel, then export the edited Products sheet as CSV before uploading it back into Admin Import.',
      },
      {
        field: 'Safe removal',
        guidance: 'Items marked remove or deactivate are set inactive in the catalog instead of being permanently deleted.',
      },
    ]);

    productSheet.columns = [
      { header: 'ProductId', key: 'productId', width: 28 },
      { header: 'ReviewAction', key: 'reviewAction', width: 18 },
      { header: 'ReviewNotes', key: 'reviewNotes', width: 28 },
      { header: 'IsActive', key: 'isActive', width: 12 },
      { header: 'Featured', key: 'featured', width: 12 },
      { header: 'Category', key: 'category', width: 32 },
      { header: 'ParentCategory', key: 'parentCategory', width: 32 },
      { header: 'CategoryPath', key: 'categoryPath', width: 44 },
      { header: 'Product', key: 'product', width: 44 },
      { header: 'Brand', key: 'brand', width: 24 },
      { header: 'SKU', key: 'sku', width: 24 },
      { header: 'Image', key: 'image', width: 32 },
      { header: 'GalleryImageCount', key: 'galleryImageCount', width: 18 },
      { header: 'VariantCount', key: 'variantCount', width: 14 },
      { header: 'SpecCount', key: 'specCount', width: 12 },
      { header: 'Price', key: 'price', width: 12 },
      { header: 'Description', key: 'description', width: 44 },
      { header: 'SortOrder', key: 'sortOrder', width: 12 },
      { header: 'CreatedAt', key: 'createdAt', width: 24 },
      { header: 'UpdatedAt', key: 'updatedAt', width: 24 },
      { header: 'CategorySlug', key: 'categorySlug', width: 32 },
    ];
    productSheet.addRows(products.map(product => ({
      productId: String(product._id || ''),
      reviewAction: '',
      reviewNotes: '',
      isActive: product.isActive !== false ? 'true' : 'false',
      featured: product.featured ? 'true' : 'false',
      category: product.categorySlug?.name || '',
      parentCategory: product.categorySlug?.parent?.name || '',
      categoryPath: [product.categorySlug?.parent?.name, product.categorySlug?.name].filter(Boolean).join(' > '),
      product: product.name || '',
      brand: product.brand || '',
      sku: product.sku || '',
      image: product.image || '',
      galleryImageCount: Array.isArray(product.images) ? product.images.filter(Boolean).length : 0,
      variantCount: Array.isArray(product.variants) ? product.variants.length : 0,
      specCount: Array.isArray(product.specs) ? product.specs.length : 0,
      price: product.basePrice ?? '',
      description: product.description || '',
      sortOrder: product.sortOrder ?? '',
      createdAt: formatIsoDate(product.createdAt),
      updatedAt: formatIsoDate(product.updatedAt),
      categorySlug: product.categorySlug?.slug || '',
    })));

    categorySheet.columns = [
      { header: 'Category', key: 'category', width: 32 },
      { header: 'ParentCategory', key: 'parentCategory', width: 32 },
      { header: 'CategorySlug', key: 'categorySlug', width: 32 },
      { header: 'SortOrder', key: 'sortOrder', width: 12 },
    ];
    categorySheet.addRows(categories.map(category => ({
      category: category.name || '',
      parentCategory: category.parent?.name || '',
      categorySlug: category.slug || '',
      sortOrder: category.sortOrder ?? '',
    })));

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="products-review-sheet.xlsx"');
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
      productId: String(item.productId || '').trim(),
      name: String(item.name || '').trim(),
      categorySlug: item.categorySlug,
      description: item.description,
      brand: item.brand,
      sku: item.sku,
      image: item.image,
      basePrice: item.basePrice,
      featured: item.featured,
      isActive: item.isActive,
      reviewAction: normalizeReviewAction(item.reviewAction),
    }))
    .filter(item => (item.name && item.categorySlug) || (mongoose.isValidObjectId(item.productId) && item.reviewAction === 'deactivate'));

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
      };
      if (hasValue(item.name)) update.name = item.name;
      if (item.categorySlug) update.categorySlug = item.categorySlug;
      if (hasValue(item.description)) update.description = item.description;
      if (hasValue(item.brand)) update.brand = item.brand;
      if (hasValue(item.sku)) update.sku = item.sku;
      if (hasValue(item.image)) update.image = item.image;
      if (hasNumber(item.basePrice)) update.basePrice = Number(item.basePrice);
      const normalizedFeatured = normalizeSpreadsheetBoolean(item.featured);
      const normalizedActive = normalizeSpreadsheetBoolean(item.isActive);
      if (normalizedFeatured !== undefined) update.featured = normalizedFeatured;
      if (normalizedActive !== undefined) update.isActive = normalizedActive;
      if (item.reviewAction === 'deactivate') update.isActive = false;

      return {
        updateOne: {
          filter: mongoose.isValidObjectId(item.productId)
            ? { _id: item.productId }
            : {
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
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }
    const product = await Product.findById(req.params.id)
      .populate({
        path: 'categorySlug',
        populate: { path: 'parent', select: 'name slug' },
      })
      .lean();
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
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!product) {
      return res.status(404).json({ message: 'Not found' });
    }
    res.json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete product
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Not found' });
    }
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
