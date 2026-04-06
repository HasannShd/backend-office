const mongoose = require('mongoose');

const quotationItemSchema = new mongoose.Schema(
  {
    productName: { type: String, required: true },
    quantity: Number,
    price: Number,
  },
  { _id: false }
);

const quotationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    clientName: String,
    items: [quotationItemSchema],
    proposedPrice: Number,
    dateSent: String,
    validityDate: String,
    notes: String,
    status: {
      type: String,
      enum: ['draft', 'sent', 'approved', 'rejected', 'converted_to_order'],
      default: 'draft',
    },
  },
  { timestamps: true }
);

quotationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Quotation', quotationSchema);
