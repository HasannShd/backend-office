const PDFDocument = require('pdfkit');

const formatBhd = (value) => `${Number(value || 0).toFixed(3)} BHD`;

const buildInvoicePdf = (order) => {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  doc.fontSize(20).text('Invoice', { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Invoice #: ${order.invoiceNumber}`, { align: 'right' });
  doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`, { align: 'right' });

  doc.moveDown();
  doc.fontSize(14).text('Customer', { underline: true });
  doc.fontSize(10).text(order.customer?.name || '');
  doc.text(order.customer?.email || '');
  doc.text(order.customer?.phone || '');

  doc.moveDown();
  doc.fontSize(14).text('Shipping Address', { underline: true });
  doc.fontSize(10).text(order.shippingAddress?.fullName || '');
  doc.text(order.shippingAddress?.line1 || '');
  if (order.shippingAddress?.line2) doc.text(order.shippingAddress.line2);
  doc.text(order.shippingAddress?.city || '');
  doc.text(order.shippingAddress?.country || '');
  doc.text(order.shippingAddress?.postalCode || '');

  doc.moveDown();
  doc.fontSize(14).text('Items', { underline: true });
  doc.moveDown(0.5);

  doc.fontSize(10);
  order.items.forEach((item) => {
    const title = `${item.name}${item.size ? ` (${item.size})` : ''}`;
    doc.text(title);
    doc.text(`Qty: ${item.quantity}  Price: ${formatBhd(item.price)}  Total: ${formatBhd(item.price * item.quantity)}`, {
      indent: 12,
    });
    doc.moveDown(0.3);
  });

  doc.moveDown();
  doc.fontSize(12).text(`Subtotal: ${formatBhd(order.subtotal)}`, { align: 'right' });
  doc.text(`Shipping: ${formatBhd(order.shippingFee)}`, { align: 'right' });
  doc.fontSize(14).text(`Total: ${formatBhd(order.total)}`, { align: 'right' });

  doc.end();
  return doc;
};

module.exports = { buildInvoicePdf };
