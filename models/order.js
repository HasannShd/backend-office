const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId },
    name: String,
    sku: String,
    size: String,
    image: String,
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    specs: [{ label: String, value: String }],
  },
  { _id: true }
);

const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    invoiceNumber: { type: String, required: true, unique: true },
    items: [orderItemSchema],
    currency: { type: String, default: 'BHD' },
    subtotal: { type: Number, required: true },
    shippingFee: { type: Number, required: true },
    total: { type: Number, required: true },
    paymentMethod: { type: String, enum: ['cod', 'bank', 'tap'], required: true },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    status: { type: String, default: 'pending' },
    statusHistory: [statusEventSchema],
    customer: {
      name: String,
      email: String,
      phone: String,
    },
    shippingAddress: {
      fullName: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      country: String,
      postalCode: String,
    },
    notes: String,
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
