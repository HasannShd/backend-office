// controllers/uploads.js
const express = require('express');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'LTE-products',        // folder name in Cloudinary
  },
});

const upload = multer({ storage });

const router = express.Router();

// ADMIN-ONLY IMAGE UPLOAD
router.post('/', verifyToken, isAdmin, upload.single('image'), (req, res) => {
  // multer-storage-cloudinary puts the Cloudinary URL on req.file.path
  return res.status(201).json({ url: req.file.path });
});

module.exports = router;