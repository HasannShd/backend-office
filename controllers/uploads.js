// controllers/uploads.js
const express = require('express');
const cloudinary = require('cloudinary');
const multer = require('multer');
const requireAuthUser = require('../middleware/require-auth-user');
const requireRoles = require('../middleware/require-roles');
const { logActivity } = require('../services/activity-log-service');

const cloudinaryV2 = cloudinary.v2 || cloudinary;
if (!cloudinary.v2) {
  cloudinary.v2 = cloudinaryV2;
}

const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (cloudinaryConfigured) {
  cloudinaryV2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} else {
  console.warn('[upload] Cloudinary is not configured. Upload endpoint will return 503.');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const allowedUploadExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
  '.svg',
  '.heic',
  '.heif',
  '.jfif',
  '.pdf',
]);

const getFileExtension = (filename = '') => {
  const match = String(filename).toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
};

const isImageUpload = (file) => {
  const mime = String(file?.mimetype || '').toLowerCase();
  const extension = getFileExtension(file?.originalname);
  return mime.startsWith('image/') || allowedUploadExtensions.has(extension) && extension !== '.pdf';
};

const isAllowedUpload = (file) => {
  if (!file) return false;

  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/') || mime === 'application/pdf') return true;

  const extension = getFileExtension(file.originalname);
  return allowedUploadExtensions.has(extension);
};

const uploadBufferToCloudinary = (fileBuffer, originalname, mimetype, folder = 'LTE-products') => new Promise((resolve, reject) => {
  const publicIdBase = String(originalname || 'upload')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 80) || `upload-${Date.now()}`;
  const extension = getFileExtension(originalname);
  const normalizedMime = String(mimetype || '').toLowerCase();
  const preferredFormat = (() => {
    if (normalizedMime === 'application/pdf' || extension === '.pdf') return 'pdf';
    if (normalizedMime === 'image/png' || extension === '.png') return 'png';
    if (normalizedMime === 'image/gif' || extension === '.gif') return 'gif';
    if (normalizedMime === 'image/svg+xml' || extension === '.svg') return 'svg';
    if (normalizedMime === 'image/webp' || extension === '.webp') return 'webp';
    if (extension === '.heic' || extension === '.heif' || extension === '.avif' || extension === '.bmp' || extension === '.jfif') {
      return 'jpg';
    }
    return 'jpg';
  })();

  const uploadStream = cloudinaryV2.uploader.upload_stream(
    {
      folder,
      resource_type: preferredFormat === 'pdf' ? 'raw' : 'image',
      public_id: `${publicIdBase}-${Date.now()}`,
      overwrite: false,
      format: preferredFormat,
    },
    (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    }
  );

  uploadStream.end(fileBuffer);
});

const router = express.Router();

// PORTAL IMAGE/DOCUMENT UPLOAD
router.post('/', requireAuthUser, requireRoles('admin', 'sales_staff'), upload.single('image'), async (req, res) => {
  try {
    if (!cloudinaryConfigured) {
      return res.status(503).json({ message: 'Cloudinary is not configured.' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No image received.' });
    }

    if (!isAllowedUpload(req.file)) {
      return res.status(400).json({ message: 'Only image or PDF uploads are allowed.' });
    }

    const result = await uploadBufferToCloudinary(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      isImageUpload(req.file) ? 'LTE-products' : 'LTE-documents'
    );

    const uploadedUrl = result?.secure_url || result?.url;
    if (!uploadedUrl) {
      return res.status(502).json({ message: 'Upload provider did not return a URL.' });
    }

    await logActivity({
      user: req.user,
      action: 'file_uploaded',
      module: 'upload',
      metadata: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        bytes: req.file.size,
        folder: isImageUpload(req.file) ? 'LTE-products' : 'LTE-documents',
      },
    });

    return res.status(201).json({ url: uploadedUrl });
  } catch (err) {
    console.error('[upload]', err);
    return res.status(500).json({ message: err.message || 'Upload failed.' });
  }
});

// Surface Cloudinary/multer errors for easier debugging
router.use((err, req, res, next) => {
  console.error('[upload]', err);
  res.status(500).json({ message: err.message || 'Upload failed.' });
});

module.exports = router;
