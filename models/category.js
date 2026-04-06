const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  slug: { type: String, unique: true, index: true }, // e.g. "dental", "lab-devices"
  description: String,
  image: String,
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
    index: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Category', categorySchema);
