// controllers/uploads.js
const express = require('express');
const cloudinary = require('cloudinary');
const multer = require('multer');
const cloudinaryStorageModule = require('multer-storage-cloudinary');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');

const cloudinaryV2 = cloudinary.v2 || cloudinary;
if (!cloudinary.v2) {
  cloudinary.v2 = cloudinaryV2;
}

const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

const createCloudinaryStorage = (options) => {
  if (typeof cloudinaryStorageModule === 'function') {
    return cloudinaryStorageModule(options);
  }
  if (typeof cloudinaryStorageModule.CloudinaryStorage === 'function') {
    return new cloudinaryStorageModule.CloudinaryStorage(options);
  }
  throw new Error('Unsupported multer-storage-cloudinary export shape.');
};

let storage = multer.memoryStorage();

if (cloudinaryConfigured) {
  cloudinaryV2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  storage = createCloudinaryStorage({
    cloudinary: cloudinaryV2,
    params: {
      folder: 'LTE-products',
    },
  });
} else {
  console.warn('[upload] Cloudinary is not configured. Upload endpoint will return 503.');
}

const upload = multer({ storage });

const router = express.Router();

// ADMIN-ONLY IMAGE UPLOAD
router.post('/', verifyToken, isAdmin, upload.single('image'), (req, res) => {
  try {
    if (!cloudinaryConfigured) {
      return res.status(503).json({ message: 'Cloudinary is not configured.' });
    }
    const uploadedUrl = req.file?.path || req.file?.secure_url || req.file?.url;
    if (!req.file || !uploadedUrl) {
      return res.status(400).json({ message: 'No image received.' });
    }
    return res.status(201).json({ url: uploadedUrl });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Upload failed.' });
  }
});

// Surface Cloudinary/multer errors for easier debugging
router.use((err, req, res, next) => {
  console.error('[upload]', err);
  res.status(500).json({ message: err.message || 'Upload failed.' });
});

module.exports = router;
