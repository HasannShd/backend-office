const mongoose = require('mongoose');

const campaignRecipientSchema = new mongoose.Schema(
  {
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingContact' },
    email: { type: String, required: true, trim: true, lowercase: true },
    name: String,
    companyName: String,
    status: {
      type: String,
      enum: ['pending', 'sent', 'skipped', 'failed'],
      default: 'pending',
    },
    messageId: String,
    error: String,
    sentAt: Date,
  },
  { _id: false }
);

const marketingCampaignSchema = new mongoose.Schema(
  {
    type: { type: String, default: 'social_follow' },
    subject: { type: String, required: true },
    previewText: String,
    instagramUrl: String,
    linkedinUrl: String,
    status: {
      type: String,
      enum: ['draft', 'sending', 'completed', 'completed_with_errors', 'failed'],
      default: 'draft',
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    startedAt: Date,
    completedAt: Date,
    totals: {
      targeted: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    recipients: { type: [campaignRecipientSchema], default: [] },
  },
  { timestamps: true }
);

marketingCampaignSchema.index({ createdAt: -1 });
marketingCampaignSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('MarketingCampaign', marketingCampaignSchema);
