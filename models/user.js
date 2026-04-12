const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  hashedPassword: { type: String, required: true },
  name: String,
  department: String,
  marketingOptIn: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
  failedLoginAttempts: { type: Number, default: 0 },
  lastFailedLoginAt: Date,
  lockedUntil: Date,
  passwordChangedAt: { type: Date, default: Date.now },
  resetPasswordTokenHash: String,
  resetPasswordExpiresAt: Date,
  address: {
    fullName: String,
    phone: String,
    line1: String,
    line2: String,
    city: String,
    country: String,
    postalCode: String,
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'sales_staff'],
    default: 'user',
  },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
