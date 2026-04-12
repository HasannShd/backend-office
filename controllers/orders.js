const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/order');
const User = require('../models/user');
const Cart = require('../models/cart');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');
const { sendMail, getNotificationRecipient } = require('../utils/mailer');
const { buildInvoicePdf } = require('../utils/invoice');
const { logActivity } = require('../services/activity-log-service');

const router = express.Router();

const generateInvoiceNumber = () => {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `LTE-${stamp}-${rand}`;
};

const calcShipping = (subtotal) => (subtotal < 10 ? 1 : 0);

const formatMoney = (value, currency = 'BHD') => `${Number(value || 0).toFixed(3)} ${currency}`;
const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const sendOrderEmail = async (order) => {
  const to = getNotificationRecipient(
    'WEBSITE_ORDER_NOTIFY_EMAIL',
    'ORDER_NOTIFY_EMAIL',
    'ATTENTION_NOTIFY_EMAIL',
    'HR_NOTIFY_EMAIL',
    'SMTP_FROM'
  );
  if (!to) return;
  const lines = order.items.map(
    (item, index) =>
      `${index + 1}. ${item.name}${item.size ? ` (${item.size})` : ''} | Qty: ${item.quantity} | Unit: ${formatMoney(
        item.price,
        order.currency
      )}`
  );
  const text = [
    `New website order ${order.invoiceNumber}`,
    `Customer: ${order.customer?.name || '-'}`,
    `Email: ${order.customer?.email || '-'}`,
    `Phone: ${order.customer?.phone || '-'}`,
    `Payment: ${order.paymentMethod || '-'}`,
    `Payment status: ${order.paymentStatus || '-'}`,
    `Created: ${order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString()}`,
    '',
    'Shipping address:',
    `${order.shippingAddress?.fullName || '-'}`,
    `${order.shippingAddress?.phone || '-'}`,
    `${order.shippingAddress?.line1 || '-'}`,
    `${order.shippingAddress?.line2 || '-'}`,
    `${order.shippingAddress?.city || '-'} ${order.shippingAddress?.postalCode || ''}`.trim(),
    `${order.shippingAddress?.country || '-'}`,
    '',
    ...lines,
    '',
    `Subtotal: ${formatMoney(order.subtotal, order.currency)}`,
    `Shipping: ${formatMoney(order.shippingFee, order.currency)}`,
    `Total: ${formatMoney(order.total, order.currency)}`,
    `Notes: ${order.notes || '-'}`,
  ].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; color: #13273f; line-height: 1.6;">
      <h2 style="margin:0 0 10px;">New Website Order</h2>
      <p style="margin:0 0 18px;"><strong>Invoice:</strong> ${escapeHtml(order.invoiceNumber)}</p>

      <table style="width:100%; border-collapse:collapse; margin-bottom:18px;">
        <tr>
          <td style="padding:10px; border:1px solid #e6dccd;"><strong>Customer</strong><br />${escapeHtml(order.customer?.name || '-')}</td>
          <td style="padding:10px; border:1px solid #e6dccd;"><strong>Email</strong><br />${escapeHtml(order.customer?.email || '-')}</td>
        </tr>
        <tr>
          <td style="padding:10px; border:1px solid #e6dccd;"><strong>Phone</strong><br />${escapeHtml(order.customer?.phone || '-')}</td>
          <td style="padding:10px; border:1px solid #e6dccd;"><strong>Payment</strong><br />${escapeHtml(order.paymentMethod || '-')} (${escapeHtml(order.paymentStatus || 'pending')})</td>
        </tr>
      </table>

      <div style="margin-bottom:18px;">
        <h3 style="margin:0 0 8px;">Shipping Address</h3>
        <div style="padding:12px; border:1px solid #e6dccd; border-radius:12px; background:#fbf8f2;">
          <div>${escapeHtml(order.shippingAddress?.fullName || '-')}</div>
          <div>${escapeHtml(order.shippingAddress?.phone || '-')}</div>
          <div>${escapeHtml(order.shippingAddress?.line1 || '-')}</div>
          ${order.shippingAddress?.line2 ? `<div>${escapeHtml(order.shippingAddress.line2)}</div>` : ''}
          <div>${escapeHtml(order.shippingAddress?.city || '-')} ${escapeHtml(order.shippingAddress?.postalCode || '')}</div>
          <div>${escapeHtml(order.shippingAddress?.country || '-')}</div>
        </div>
      </div>

      <h3 style="margin:0 0 8px;">Items</h3>
      <table style="width:100%; border-collapse:collapse; margin-bottom:18px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:10px; border:1px solid #e6dccd;">Product</th>
            <th style="text-align:left; padding:10px; border:1px solid #e6dccd;">Qty</th>
            <th style="text-align:left; padding:10px; border:1px solid #e6dccd;">Unit</th>
            <th style="text-align:left; padding:10px; border:1px solid #e6dccd;">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${order.items
            .map(
              (item) => `
                <tr>
                  <td style="padding:10px; border:1px solid #e6dccd;">${escapeHtml(item.name || '-')}${
                    item.size ? `<br /><span style="color:#6a7b90;">${escapeHtml(item.size)}</span>` : ''
                  }</td>
                  <td style="padding:10px; border:1px solid #e6dccd;">${item.quantity}</td>
                  <td style="padding:10px; border:1px solid #e6dccd;">${formatMoney(item.price, order.currency)}</td>
                  <td style="padding:10px; border:1px solid #e6dccd;">${formatMoney(
                    Number(item.price || 0) * Number(item.quantity || 0),
                    order.currency
                  )}</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>

      <div style="padding:12px; border:1px solid #e6dccd; border-radius:12px; background:#fbf8f2; margin-bottom:18px;">
        <div><strong>Subtotal:</strong> ${formatMoney(order.subtotal, order.currency)}</div>
        <div><strong>Shipping:</strong> ${formatMoney(order.shippingFee, order.currency)}</div>
        <div><strong>Total:</strong> ${formatMoney(order.total, order.currency)}</div>
      </div>

      <div><strong>Notes:</strong> ${escapeHtml(order.notes || '-')}</div>
    </div>
  `;
  await sendMail({ to, subject: `New Website Order | ${order.invoiceNumber}`, text, html });
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
    if (paymentMethod === 'tap') {
      return res.status(503).json({ message: 'Tap checkout is not available yet.' });
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

    await logActivity({
      user: req.user,
      action: 'website_order_created',
      module: 'order',
      recordId: order._id,
      metadata: { invoiceNumber: order.invoiceNumber, total: order.total },
    });

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
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
    const allowedStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }
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
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
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
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const actor = req.user.role ? req.user : await User.findById(req.user._id);
    await logActivity({
      user: actor,
      action: 'invoice_downloaded',
      module: 'order',
      recordId: order._id,
      metadata: { invoiceNumber: order.invoiceNumber, actorRole: req.user.role },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${order.invoiceNumber}.pdf"`);
    const pdfDoc = buildInvoicePdf(order);
    pdfDoc.pipe(res);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
