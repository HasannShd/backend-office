const mongoose = require('mongoose');

const stockRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    item: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    reason: String,
    urgency: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    status: {
      type: String,
      enum: ['submitted', 'under_review', 'approved', 'rejected', 'fulfilled'],
      default: 'submitted',
    },
    adminNote: String,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
  },
  { timestamps: true }
);

stockRequestSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('StockRequest', stockRequestSchema);
