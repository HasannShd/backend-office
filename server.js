require('dotenv').config();
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
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

app.get('/', (req, res) => {
  res.json({ message: 'Server is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/careers', careersRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(process.env.PORT || 5000, () =>
      console.log(`Server running on port ${process.env.PORT || 5000}`)
    );
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
