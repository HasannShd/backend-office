const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  hashedPassword: { type: String, required: true },
  name: String,
  marketingOptIn: { type: Boolean, default: false },
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
    enum: ['user', 'admin'],
    default: 'user',
  },
}, { timestamps: true });

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });

module.exports = mongoose.model('User', userSchema);
