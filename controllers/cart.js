const express = require('express');
const Cart = require('../models/cart');
const Product = require('../models/product');
const verifyToken = require('../middleware/verify-token');

const router = express.Router();

const findVariant = (product, variantId) => {
  if (!variantId) return null;
  return product.variants.find(v => v._id.toString() === variantId.toString()) || null;
};

const ensureCart = async (userId) => {
  const existing = await Cart.findOne({ user: userId });
  if (existing) return existing;
  return Cart.create({ user: userId, items: [] });
};

router.get('/', verifyToken, async (req, res) => {
  try {
    const cart = await ensureCart(req.user._id);
    res.json(cart);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/items', verifyToken, async (req, res) => {
  try {
    const { productId, variantId, quantity, size } = req.body;
    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({ message: 'Product and quantity are required.' });
    }

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const variant = findVariant(product, variantId);
    if (variantId && !variant) {
      return res.status(404).json({ message: 'Variant not found.' });
    }
    if (variant && variant.isActive === false) {
      return res.status(400).json({ message: 'Variant is inactive.' });
    }
    let selectedSizeLabel = '';
    let sizeEntry = null;
    if (variant?.sizes?.length) {
      sizeEntry = variant.sizes.find(entry => {
        const label = [entry.size, entry.inches, entry.color].filter(Boolean).join(' / ');
        return label === size;
      });
      if (!sizeEntry) {
        return res.status(400).json({ message: 'Size not found for this variant.' });
      }
      if (sizeEntry.outOfStock) {
        return res.status(400).json({ message: 'Selected size is out of stock.' });
      }
      selectedSizeLabel = [sizeEntry.size, sizeEntry.inches, sizeEntry.color].filter(Boolean).join(' / ');
    }

    const cart = await ensureCart(req.user._id);
    const variantSizeLabel = variant
      ? [variant.type, selectedSizeLabel].filter(Boolean).join(' / ')
      : '';
    const existingItem = cart.items.find(item =>
      item.product.toString() === productId &&
      String(item.variantId || '') === String(variantId || '') &&
      String(item.size || '') === String(variantSizeLabel || '')
    );

    const sizePrice = Number(sizeEntry?.price);
    const variantPrice = Number(variant?.price);
    const basePrice = Number(product.basePrice);
    const price = Number.isFinite(sizePrice) && sizePrice > 0
      ? sizePrice
      : (Number.isFinite(variantPrice) && variantPrice > 0
          ? variantPrice
          : (Number.isFinite(basePrice) ? basePrice : 0));
    const itemPayload = {
      product: product._id,
      variantId: variant?._id,
      name: product.name,
      sku: variant?.sku || product.sku,
      size: variantSizeLabel || variant?.name,
      image: product.image || product.images?.[0],
      price,
      quantity,
      specs: variant?.specs?.length ? variant.specs : product.specs,
    };

    if (existingItem) {
      existingItem.quantity = quantity;
      existingItem.price = price;
    } else {
      cart.items.push(itemPayload);
    }

    await cart.save();
    res.status(201).json(cart);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/items/:itemId', verifyToken, async (req, res) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity < 1) return res.status(400).json({ message: 'Quantity required.' });
    const cart = await ensureCart(req.user._id);
    const item = cart.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Item not found.' });
    item.quantity = quantity;
    await cart.save();
    res.json(cart);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/items/:itemId', verifyToken, async (req, res) => {
  try {
    const cart = await ensureCart(req.user._id);
    const item = cart.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Item not found.' });
    item.remove();
    await cart.save();
    res.json(cart);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/clear', verifyToken, async (req, res) => {
  try {
    const cart = await ensureCart(req.user._id);
    cart.items = [];
    await cart.save();
    res.json(cart);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
