const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    clientName: String,
    relatedRecordType: String,
    relatedRecord: mongoose.Schema.Types.Mixed,
    dueDate: { type: String, required: true },
    note: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'completed', 'missed'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

followUpSchema.index({ user: 1, dueDate: 1, status: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
