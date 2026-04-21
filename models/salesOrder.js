const mongoose = require('mongoose');

const salesOrderItemSchema = new mongoose.Schema(
  {
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    uom: String,
    vatApplicable: { type: Boolean, default: false },
    vatAmount: Number,
    price: Number,
  },
  { _id: false }
);

const salesOrderAttachmentSchema = new mongoose.Schema(
  {
    name: String,
    url: { type: String, required: true },
    mimeType: String,
  },
  { _id: false }
);

const salesOrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    customerName: { type: String, required: true },
    companyName: String,
    contactPerson: String,
    items: { type: [salesOrderItemSchema], validate: [(value) => value.length > 0, 'At least one item is required.'] },
    attachments: { type: [salesOrderAttachmentSchema], default: [] },
    notes: String,
    urgency: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    vatApplicable: { type: Boolean, default: false },
    vatAmount: Number,
    orderTiming: { type: String, enum: ['today', 'tomorrow'], default: 'today' },
    requestedForDate: String,
    deliveryNote: String,
    status: {
      type: String,
      enum: ['submitted', 'reviewed', 'emailed', 'confirmed', 'delivered', 'cancelled'],
      default: 'submitted',
    },
    submittedAt: { type: Date, default: Date.now },
    emailSent: { type: Boolean, default: false },
    emailSentAt: Date,
    emailError: String,
    tallySyncStatus: {
      type: String,
      enum: ['not_configured', 'pending', 'skipped', 'failed', 'success'],
      default: 'not_configured',
    },
    statusHistory: [
      new mongoose.Schema(
        {
          status: String,
          note: String,
          changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          changedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
    ],
  },
  { timestamps: true }
);

salesOrderSchema.index({ user: 1, createdAt: -1 });
salesOrderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SalesOrder', salesOrderSchema);
