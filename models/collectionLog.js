const mongoose = require('mongoose');

const collectionLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    clientName: String,
    reference: String,
    amountDue: Number,
    amountCollected: Number,
    status: {
      type: String,
      enum: ['pending', 'partial', 'collected', 'overdue'],
      default: 'pending',
    },
    collectionDate: String,
    notes: String,
  },
  { timestamps: true }
);

collectionLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('CollectionLog', collectionLogSchema);
