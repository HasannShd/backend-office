const express = require('express');
const Order = require('../models/order');
const User = require('../models/user');
const Cart = require('../models/cart');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');
const { sendMail } = require('../utils/mailer');
const { buildInvoicePdf } = require('../utils/invoice');

const router = express.Router();

const generateInvoiceNumber = () => {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `LTE-${stamp}-${rand}`;
};

const calcShipping = (subtotal) => (subtotal < 10 ? 1 : 0);

const sendOrderEmail = async (order) => {
  const to = process.env.ORDER_NOTIFY_EMAIL || process.env.SMTP_FROM;
  if (!to) return;
  const lines = order.items.map(item =>
    `${item.name} ${item.size ? `(${item.size})` : ''} x${item.quantity} - ${item.price}`
  );
  const text = [
    `New order ${order.invoiceNumber}`,
    `Customer: ${order.customer?.name} (${order.customer?.phone})`,
    `Payment: ${order.paymentMethod}`,
    '',
    ...lines,
    '',
    `Subtotal: ${order.subtotal} BHD`,
    `Shipping: ${order.shippingFee} BHD`,
    `Total: ${order.total} BHD`,
  ].join('\n');
  await sendMail({ to, subject: `New Order ${order.invoiceNumber}`, text });
};

const tapConfigured = () => Boolean(process.env.TAP_SECRET_KEY);

router.get('/tap/ready', (req, res) => {
  res.json({ ready: tapConfigured() });
});

router.post('/tap/session', verifyToken, async (req, res) => {
  if (!tapConfigured()) {
    return res.status(503).json({ message: 'Tap is not configured.' });
  }
  res.status(501).json({ message: 'Tap integration is pending setup.' });
});

router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const { paymentMethod, shippingAddress, notes } = req.body;
    if (!paymentMethod || !shippingAddress?.line1) {
      return res.status(400).json({ message: 'Payment method and address are required.' });
    }
    if (!['cod', 'bank', 'tap'].includes(paymentMethod)) {
      return res.status(400).json({ message: 'Invalid payment method.' });
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty.' });
    }

    const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shippingFee = calcShipping(subtotal);
    const total = subtotal + shippingFee;

    const invoiceNumber = generateInvoiceNumber();
    const user = await User.findById(req.user._id);
    const order = await Order.create({
      user: req.user._id,
      invoiceNumber,
      items: cart.items,
      subtotal,
      shippingFee,
      total,
      paymentMethod,
      status: 'pending',
      statusHistory: [{ status: 'pending', note: 'Order created' }],
      customer: {
        name: user?.name || user?.username,
        email: user?.email,
        phone: user?.phone,
      },
      shippingAddress,
      notes,
    });

    if (user) {
      user.address = shippingAddress;
      await user.save();
    }

    cart.items = [];
    await cart.save();

    await sendOrderEmail(order);

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/admin', verifyToken, isAdmin, async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id/status', verifyToken, isAdmin, async (req, res) => {
  try {
    const { status, note } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.status = status || order.status;
    order.statusHistory.push({ status: order.status, note });
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id/invoice', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${order.invoiceNumber}.pdf"`);
    const pdfDoc = buildInvoicePdf(order);
    pdfDoc.pipe(res);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
