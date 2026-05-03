const crypto = require('crypto');
const mongoose = require('mongoose');

const marketingContactSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, trim: true },
    companyName: { type: String, trim: true },
    phone: { type: String, trim: true },
    source: { type: String, trim: true, default: 'manual_import' },
    notes: { type: String, trim: true },
    consentStatus: {
      type: String,
      enum: ['existing_client', 'opted_in', 'unknown', 'unsubscribed'],
      default: 'existing_client',
    },
    unsubscribeToken: { type: String, required: true, unique: true },
    unsubscribedAt: Date,
    lastCampaignSentAt: Date,
    lastCampaignSubject: String,
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

marketingContactSchema.pre('validate', function assignUnsubscribeToken(next) {
  if (!this.unsubscribeToken) {
    this.unsubscribeToken = crypto.randomBytes(24).toString('hex');
  }
  next();
});

marketingContactSchema.index({ unsubscribedAt: 1, updatedAt: -1 });

module.exports = mongoose.model('MarketingContact', marketingContactSchema);
