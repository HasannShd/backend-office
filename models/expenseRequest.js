const mongoose = require('mongoose');

const expenseRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    expenseDate: { type: String, required: true },
    description: String,
    relatedReference: String,
    relatedClient: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    receiptUrl: String,
    paymentMethod: String,
    status: {
      type: String,
      enum: ['submitted', 'under_review', 'approved', 'rejected', 'paid'],
      default: 'submitted',
    },
    adminNote: String,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    paidAt: Date,
  },
  { timestamps: true }
);

expenseRequestSchema.index({ user: 1, createdAt: -1 });
expenseRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ExpenseRequest', expenseRequestSchema);
