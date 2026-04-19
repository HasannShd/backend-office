const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/order');
const User = require('../models/user');
const Cart = require('../models/cart');
const verifyToken = require('../middleware/verify-token');
const isAdmin = require('../middleware/is-admin');
const { sendMail, getNotificationRecipient } = require('../utils/mailer');
const { escapeHtml, renderNotificationEmail } = require('../utils/notification-email');
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
    'Dear Madam,',
    '',
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
    '',
    'Regards',
    'Leading Trading Team',
    'Operations Department',
  ].join('\n');
  const html = renderNotificationEmail({
    preheader: 'LTE Website Order Notification',
    heading: 'New Website Order',
    introLines: [
      'Dear Madam,',
      'A new website order has been placed and is ready for review.',
    ],
    detailRows: [
      { label: 'Invoice', value: order.invoiceNumber || '-' },
      { label: 'Customer', value: order.customer?.name || '-' },
      { label: 'Email', value: order.customer?.email || '-' },
      { label: 'Phone', value: order.customer?.phone || '-' },
      { label: 'Payment', value: `${order.paymentMethod || '-'} (${order.paymentStatus || 'pending'})` },
      { label: 'Created', value: order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString() },
      {
        label: 'Shipping Address',
        value: [
          order.shippingAddress?.fullName,
          order.shippingAddress?.phone,
          order.shippingAddress?.line1,
          order.shippingAddress?.line2,
          `${order.shippingAddress?.city || '-'} ${order.shippingAddress?.postalCode || ''}`.trim(),
          order.shippingAddress?.country,
        ].filter(Boolean).join(', '),
      },
      { label: 'Notes', value: order.notes || '-' },
    ],
    sectionTitle: 'Items',
    sectionBody: `
      <table style="width:100%; border-collapse:collapse; margin:0 0 18px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">Product</th>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">Qty</th>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">Unit</th>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${order.items
            .map(
              (item) => `
                <tr>
                  <td style="padding:10px 12px; border:1px solid #d7e0ea;">${escapeHtml(item.name || '-')}${
                    item.size ? `<br /><span style="color:#6a7b90;">${escapeHtml(item.size)}</span>` : ''
                  }</td>
                  <td style="padding:10px 12px; border:1px solid #d7e0ea;">${item.quantity}</td>
                  <td style="padding:10px 12px; border:1px solid #d7e0ea;">${escapeHtml(formatMoney(item.price, order.currency))}</td>
                  <td style="padding:10px 12px; border:1px solid #d7e0ea;">${escapeHtml(
                    formatMoney(Number(item.price || 0) * Number(item.quantity || 0), order.currency)
                  )}</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
      <table style="width:100%; border-collapse:collapse; margin:0 0 18px;">
        <tr>
          <td style="padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; font-weight:700; color:#123a66;">Subtotal</td>
          <td style="padding:10px 12px; border:1px solid #d7e0ea;">${escapeHtml(formatMoney(order.subtotal, order.currency))}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; font-weight:700; color:#123a66;">Shipping</td>
          <td style="padding:10px 12px; border:1px solid #d7e0ea;">${escapeHtml(formatMoney(order.shippingFee, order.currency))}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; font-weight:700; color:#123a66;">Total</td>
          <td style="padding:10px 12px; border:1px solid #d7e0ea;">${escapeHtml(formatMoney(order.total, order.currency))}</td>
        </tr>
      </table>
    `,
  });
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
