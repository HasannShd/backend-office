const mongoose = require('mongoose');

const productDemandSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    clientName: String,
    productName: { type: String, required: true },
    quantityEstimate: String,
    urgency: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    notes: String,
  },
  { timestamps: true }
);

productDemandSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('ProductDemand', productDemandSchema);
