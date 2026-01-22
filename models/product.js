const mongoose = require('mongoose');

const specSchema = new mongoose.Schema(
  {
    label: String,
    value: String,
  },
  { _id: false }
);

const variantSizeSchema = new mongoose.Schema(
  {
    size: String,
    inches: String,
    color: String,
    outOfStock: { type: Boolean, default: false },
  },
  { _id: false }
);

const variantSchema = new mongoose.Schema(
  {
    name: String,
    type: String,
    sku: String,
    image: String,
    price: { type: Number, required: true },
    sizes: [variantSizeSchema],
    isActive: { type: Boolean, default: true },
    specs: [specSchema],
  },
  { _id: true }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    categorySlug: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      // required: true,
    }, // same as in your current file
    description: String,
    image: String,  // e.g. "/Categories/cssd.webp"
    images: [String],
    sku: String,
    brand: String,
    basePrice: { type: Number, default: 0 },
    specs: [specSchema],
    variants: [variantSchema],
    featured: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ name: 1 });
productSchema.index({ categorySlug: 1, isActive: 1 });

module.exports = mongoose.model('Product', productSchema);
