const mongoose = require('mongoose');

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
    sku: String,
    brand: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
