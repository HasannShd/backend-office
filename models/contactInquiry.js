const mongoose = require('mongoose');

const quoteContextSchema = new mongoose.Schema(
  {
    source: String,
    productId: String,
    productName: String,
    sku: String,
    categoryId: String,
    categoryName: String,
    pageUrl: String,
  },
  { _id: false }
);

const contactInquirySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    quantity: { type: String, trim: true },
    urgency: { type: String, trim: true },
    preferredContact: { type: String, trim: true },
    message: { type: String, trim: true },
    quoteContext: quoteContextSchema,
    consent: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['new', 'notified', 'notification_failed', 'closed'],
      default: 'new',
    },
    notificationError: String,
    userAgent: String,
    ipAddress: String,
  },
  { timestamps: true }
);

contactInquirySchema.index({ createdAt: -1 });
contactInquirySchema.index({ status: 1, createdAt: -1 });
contactInquirySchema.index({ email: 1, createdAt: -1 });
contactInquirySchema.index({ 'quoteContext.sku': 1, createdAt: -1 });

module.exports = mongoose.model('ContactInquiry', contactInquirySchema);
