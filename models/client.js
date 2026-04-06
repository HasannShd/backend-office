const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    companyType: String,
    department: String,
    contactPerson: String,
    phone: String,
    email: String,
    address: String,
    location: String,
    notes: String,
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

clientSchema.index({ name: 1 });
clientSchema.index({ assignedTo: 1, createdAt: -1 });

module.exports = mongoose.model('Client', clientSchema);
