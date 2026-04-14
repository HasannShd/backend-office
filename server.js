require('dotenv').config();

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const authRoutes = require('./controllers/auth');
const userRoutes = require('./controllers/users');
const productRoutes = require('./controllers/products');
const categoryRoutes = require('./controllers/categories');
const uploadRoutes = require('./controllers/uploads');
const cartRoutes = require('./controllers/cart');
const orderRoutes = require('./controllers/orders');
const careersRoutes = require('./controllers/careers');
const staffPortalRoutes = require('./controllers/staffPortal');
const adminPortalRoutes = require('./controllers/adminPortal');
const app = express();
const port = process.env.PORT || 5000;
let mongoReady = false;
let mongoConnectInFlight = false;

app.set('trust proxy', 1);
app.disable('x-powered-by');

console.log('Boot config:', {
  hasMongoUri: Boolean(mongoUri),
  hasClientUrl: Boolean(process.env.CLIENT_URL),
  hasAllowedOrigins: Boolean(process.env.ALLOWED_ORIGINS),
  hasJwtSecret: Boolean(process.env.JWT_SECRET),
  hasCloudinary: Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ),
});

const allowedOrigins = Array.from(
  new Set(
    [
      process.env.CLIENT_URL,
      process.env.CLIENT_URL_2,
      process.env.CLIENT_URL_3,
      ...(process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((value) => value.trim()),
      'https://www.lte-bh.com',
      'https://lte-bh.com',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ].filter(Boolean)
  )
);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '2mb' }));

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api/admin-portal/exports', exportLimiter);
app.use('/api/staff-portal/orders/export', exportLimiter);
app.use('/api/staff-portal/clients/export', exportLimiter);

app.get('/', (req, res) => {
  res.json({ message: 'Server is running', mongoReady });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/careers', careersRoutes);
app.use('/api/staff-portal', staffPortalRoutes);
app.use('/api/admin-portal', adminPortalRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, message: 'API route not found.' });
});

app.use((error, req, res, next) => {
  console.error('[api]', error);
  if (res.headersSent) {
    return next(error);
  }
  return res.status(error.status || 500).json({
    ok: false,
    message: error.message || 'Internal server error.',
  });
});

if (!mongoUri) {
  console.error('Missing required environment variable: MONGO_URI or MONGODB_URI');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('Missing required environment variable: JWT_SECRET');
  process.exit(1);
}

mongoose.connection.on('connecting', () => {
  console.log('MongoDB connecting...');
});

mongoose.connection.on('connected', () => {
  console.log('MongoDB connected');
  mongoReady = true;
});

mongoose.connection.on('error', (error) => {
  console.error('MongoDB connection event error:', error);
  mongoReady = false;
});

mongoose.connection.on('disconnected', () => {
  console.error('MongoDB disconnected');
  mongoReady = false;
});

const connectToMongo = async () => {
  if (mongoConnectInFlight || mongoReady) return;
  mongoConnectInFlight = true;
  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
      family: 4,
    });
  } catch (err) {
    console.error('MongoDB connection error:', err);
  } finally {
    mongoConnectInFlight = false;
  }
};

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  connectToMongo();
  setInterval(connectToMongo, 30000);
});
