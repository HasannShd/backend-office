const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    name: String,
    url: { type: String, required: true },
    mimeType: String,
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['admin', 'sales_staff'], required: true },
    text: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    readByAdmin: { type: Boolean, default: false },
    readByStaff: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const messageThreadSchema = new mongoose.Schema(
  {
    staffUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

messageThreadSchema.index({ staffUser: 1, updatedAt: -1 });

module.exports = mongoose.model('MessageThread', messageThreadSchema);
