const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true }, // e.g. "dental", "lab-devices"
  description: String,
}, { timestamps: true });

module.exports = mongoose.model('Category', categorySchema);
