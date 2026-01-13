const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId },
    name: String,
    sku: String,
    size: String,
    image: String,
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    specs: [{ label: String, value: String }],
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
    items: [cartItemSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cart', cartSchema);
