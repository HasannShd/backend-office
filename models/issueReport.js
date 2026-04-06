const mongoose = require('mongoose');

const issueReportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder' },
    issueType: { type: String, required: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    description: { type: String, required: true },
    status: {
      type: String,
      enum: ['submitted', 'under_review', 'resolved', 'closed'],
      default: 'submitted',
    },
    adminNote: String,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
  },
  { timestamps: true }
);

issueReportSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('IssueReport', issueReportSchema);
