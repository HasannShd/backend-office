const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/product');
const Category = require('../models/category');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');
const ExcelJS = require('exceljs');
const multer = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

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

const getCellValue = (cell) => {
  const value = cell?.value;
  if (value === null || typeof value === 'undefined') return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.hyperlink) return String(value.hyperlink);
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (value.result !== undefined) return String(value.result);
    return String(value);
  }
  return String(value);
};

const normalizeHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const headerAliases = {
  productId: ['productid', 'id'],
  reviewAction: ['reviewaction', 'action'],
  isActive: ['isactive', 'active', 'status'],
  featured: ['featured'],
  category: ['category', 'categoryname'],
  parentCategory: ['parentcategory', 'parent'],
  categoryPath: ['categorypath', 'path'],
  product: ['product', 'productname', 'name', 'item'],
  brand: ['brand'],
  sku: ['sku', 'itemcode', 'code'],
  image: ['image', 'imageurl'],
  basePrice: ['price', 'baseprice'],
  description: ['description', 'desc'],
  sortOrder: ['sortorder', 'sort'],
  categorySlug: ['categoryslug', 'slug'],
};

const findHeaderIndex = (headers, aliases) =>
  headers.findIndex(header => aliases.includes(normalizeHeader(header)));

const parseCsvText = (text) => {
  const rows = [];
  let currentCell = '';
  let currentRow = [];
  let inQuotes = false;

  const pushCell = () => {
    currentRow.push(currentCell.trim());
    currentCell = '';
  };

  const pushRow = () => {
    if (currentRow.some(cell => cell)) rows.push(currentRow);
    currentRow = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === ',') {
      pushCell();
      continue;
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      pushCell();
      pushRow();
      if (char === '\r' && nextChar === '\n') index += 1;
      continue;
    }
    currentCell += char;
  }

  if (currentCell || currentRow.length) {
    pushCell();
    pushRow();
  }

  return rows;
};

const rowsToImportItems = (rows) => {
  const cleaned = rows
    .map(row => row.map(cell => String(cell ?? '').trim()))
    .filter(row => row.some(Boolean));
  if (!cleaned.length) return [];

  const headerIndex = cleaned.findIndex(row => {
    const normalized = row.map(normalizeHeader);
    return normalized.includes('product') || normalized.includes('productid') || normalized.includes('category');
  });
  if (headerIndex < 0) return [];

  const headers = cleaned[headerIndex];
  const dataRows = cleaned.slice(headerIndex + 1);
  const indexes = Object.fromEntries(
    Object.entries(headerAliases).map(([key, aliases]) => [key, findHeaderIndex(headers, aliases)])
  );

  const pick = (row, key) => {
    const index = indexes[key];
    return index >= 0 ? String(row[index] ?? '').trim() : '';
  };
  const hasColumn = (key) => indexes[key] >= 0;

  return dataRows
    .map(row => ({
      productId: pick(row, 'productId'),
      reviewAction: pick(row, 'reviewAction'),
      isActive: hasColumn('isActive') ? pick(row, 'isActive') : undefined,
      featured: hasColumn('featured') ? pick(row, 'featured') : undefined,
      category: pick(row, 'category'),
      parentCategory: pick(row, 'parentCategory'),
      categoryPath: pick(row, 'categoryPath'),
      name: pick(row, 'product'),
      brand: hasColumn('brand') ? pick(row, 'brand') : undefined,
      sku: hasColumn('sku') ? pick(row, 'sku') : undefined,
      image: hasColumn('image') ? pick(row, 'image') : undefined,
      basePrice: hasColumn('basePrice') ? pick(row, 'basePrice') : undefined,
      description: hasColumn('description') ? pick(row, 'description') : undefined,
      sortOrder: hasColumn('sortOrder') ? pick(row, 'sortOrder') : undefined,
      categorySlug: pick(row, 'categorySlug'),
      _sourceFields: {
        brand: hasColumn('brand'),
        sku: hasColumn('sku'),
        image: hasColumn('image'),
        basePrice: hasColumn('basePrice'),
        description: hasColumn('description'),
        sortOrder: hasColumn('sortOrder'),
        featured: hasColumn('featured'),
        isActive: hasColumn('isActive'),
      },
    }))
    .filter(item => item.productId || item.name || item.category || item.categorySlug);
};

const loadImportFileItems = async (file) => {
  const filename = String(file?.originalname || '').toLowerCase();
  if (filename.endsWith('.csv')) {
    return rowsToImportItems(parseCsvText(file.buffer.toString('utf8').replace(/^\uFEFF/, '')));
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const worksheet = workbook.getWorksheet('Products') || workbook.worksheets.find(sheet => normalizeHeader(sheet.name) !== 'instructions') || workbook.worksheets[0];
  if (!worksheet) return [];

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    const maxCell = row.actualCellCount || row.cellCount || 0;
    for (let index = 1; index <= maxCell; index += 1) {
      values.push(getCellValue(row.getCell(index)));
    }
    rows.push(values);
  });
  return rowsToImportItems(rows);
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

const setFreshCatalogHeaders = (res) => {
  res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
};

const buildCategoryLookup = async () => {
  const categories = await Category.find({})
    .select('name slug parent')
    .populate('parent', 'name slug')
    .lean();
  const map = new Map();
  const add = (value, id) => {
    const key = String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    if (key) map.set(key, String(id));
  };

  categories.forEach(category => {
    add(category._id, category._id);
    add(category.name, category._id);
    add(category.slug, category._id);
    add([category.parent?.name, category.name].filter(Boolean).join(' > '), category._id);
    add([category.parent?.slug, category.slug].filter(Boolean).join(' > '), category._id);
  });

  return map;
};

const resolveCategoryId = (item, categoryLookup) => {
  if (mongoose.isValidObjectId(item.categorySlug)) return String(item.categorySlug);
  const candidates = [
    item.categorySlug,
    item.category,
    item.categoryRaw,
    item.categoryPath,
    [item.parentCategory, item.category].filter(Boolean).join(' > '),
  ];

  for (const candidate of candidates) {
    const key = String(candidate || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    if (key && categoryLookup.has(key)) return categoryLookup.get(key);
  }
  return '';
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const processProductImportItems = async (rawItems = []) => {
  const categoryLookup = await buildCategoryLookup();
  const skipped = [];
  const prepared = [];

  rawItems.forEach((rawItem, index) => {
    const reviewAction = normalizeReviewAction(rawItem.reviewAction);
    if (reviewAction === 'skip') {
      skipped.push({ row: index + 1, reason: 'Marked skip' });
      return;
    }

    const item = {
      ...rawItem,
      productId: String(rawItem.productId || '').trim(),
      name: String(rawItem.name || rawItem.product || '').trim(),
      categorySlug: resolveCategoryId(rawItem, categoryLookup),
      reviewAction,
      _rowNumber: index + 1,
    };

    if (item.reviewAction === 'deactivate' && mongoose.isValidObjectId(item.productId)) {
      prepared.push(item);
      return;
    }

    if (!item.name || !item.categorySlug) {
      skipped.push({
        row: item._rowNumber,
        product: item.name,
        reason: !item.name ? 'Missing product name' : 'Category not matched',
      });
      return;
    }

    prepared.push(item);
  });

  let inserted = 0;
  let updated = 0;
  let matched = 0;
  const seenKeys = new Set();

  for (const item of prepared) {
    const sourceFields = item._sourceFields || {};
    const update = {};

    if (item.name) update.name = item.name;
    if (item.categorySlug) update.categorySlug = item.categorySlug;

    const setStringField = (key) => {
      if (sourceFields[key] || hasOwn(item, key)) {
        update[key] = String(item[key] ?? '').trim();
      }
    };

    setStringField('description');
    setStringField('brand');
    setStringField('sku');
    setStringField('image');

    if (sourceFields.basePrice || hasOwn(item, 'basePrice')) {
      const price = Number(item.basePrice);
      update.basePrice = Number.isFinite(price) ? price : 0;
    }

    if (sourceFields.sortOrder || hasOwn(item, 'sortOrder')) {
      const sortOrder = Number(item.sortOrder);
      if (Number.isFinite(sortOrder)) update.sortOrder = sortOrder;
    }

    const normalizedFeatured = normalizeSpreadsheetBoolean(item.featured);
    const normalizedActive = normalizeSpreadsheetBoolean(item.isActive);
    if (normalizedFeatured !== undefined) update.featured = normalizedFeatured;
    if (normalizedActive !== undefined) update.isActive = normalizedActive;
    if (item.reviewAction === 'deactivate') update.isActive = false;

    const sku = String(item.sku || '').trim();
    const nameKey = `${item.categorySlug}:${item.name.toLowerCase()}`;
    const importKey = mongoose.isValidObjectId(item.productId)
      ? `id:${item.productId}`
      : sku
        ? `sku:${sku.toLowerCase()}`
        : `name:${nameKey}`;
    if (seenKeys.has(importKey)) {
      skipped.push({ row: item._rowNumber, product: item.name, reason: 'Duplicate row in import file' });
      continue;
    }
    seenKeys.add(importKey);

    const filters = [];
    if (mongoose.isValidObjectId(item.productId)) filters.push({ _id: item.productId });
    if (sku) filters.push({ sku: { $regex: `^${escapeRegex(sku)}$`, $options: 'i' } });
    if (item.name && item.categorySlug) {
      filters.push({
        categorySlug: item.categorySlug,
        name: { $regex: `^${escapeRegex(item.name)}$`, $options: 'i' },
      });
    }

    const existing = filters.length ? await Product.findOne({ $or: filters }).select('_id').lean() : null;
    if (existing?._id) {
      matched += 1;
      const result = await Product.updateOne({ _id: existing._id }, { $set: update });
      if (result.modifiedCount) updated += 1;
      continue;
    }

    if (item.reviewAction === 'deactivate') {
      skipped.push({ row: item._rowNumber, product: item.name, reason: 'No matching product to deactivate' });
      continue;
    }

    await Product.create(update);
    inserted += 1;
  }

  return {
    inserted,
    updated,
    matched,
    skipped: skipped.length,
    skippedRows: skipped.slice(0, 25),
    attempted: rawItems.length,
    processed: prepared.length,
  };
};

// ---------- PUBLIC ROUTES ----------

// Get all products (with optional filters)
router.get('/', async (req, res) => {
  try {
    setFreshCatalogHeaders(res);
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
        { description: { $regex: pattern, $options: 'i' } },
        { brand: { $regex: pattern, $options: 'i' } },
        { sku: { $regex: pattern, $options: 'i' } },
      ];
    }
    if (featured === 'true') filter.featured = true;

    const skip = (pageNumber - 1) * limitNumber;
    const [products, total] = await Promise.all([
      Product.find(filter)
        .select('name description brand sku image images basePrice variants.price variants.type variants.sku variants.name variants.image categorySlug featured')
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
        guidance: 'Review in Excel and upload this same .xlsx file back into Admin Import. You can also upload a CSV exported from the Products sheet.',
      },
      {
        field: 'Safe removal',
        guidance: 'Do not delete rows to remove products. Keep the row and mark ReviewAction as remove/deactivate, or set IsActive to false. The product is set inactive instead of permanently deleted.',
      },
      {
        field: 'Duplicate protection',
        guidance: 'Existing products are matched by ProductId first, then SKU, then Product + Category. Keep ProductId and SKU columns unchanged unless you are intentionally adding a new item.',
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
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ message: 'No items provided' });
    }
    const result = await processProductImportItems(items);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

router.post('/import-file', verifyToken, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const filename = String(req.file.originalname || '').toLowerCase();
    if (!filename.endsWith('.xlsx') && !filename.endsWith('.csv')) {
      return res.status(400).json({ message: 'Upload the exported .xlsx review sheet or a CSV file.' });
    }

    const items = await loadImportFileItems(req.file);
    if (!items.length) {
      return res.status(400).json({ message: 'No importable product rows found. Use the exported Products sheet format.' });
    }

    const result = await processProductImportItems(items);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message || 'Import file failed' });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    setFreshCatalogHeaders(res);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }
    const product = await Product.findOne({ _id: req.params.id, isActive: true })
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
