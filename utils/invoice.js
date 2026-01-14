const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const formatBhd = (value) => `${Number(value || 0).toFixed(3)} BHD`;

const buildInvoicePdf = (order) => {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  const templatePath = path.join(__dirname, '..', 'invoice template.jpeg');
  if (fs.existsSync(templatePath)) {
    doc.image(templatePath, 0, 0, { width: doc.page.width, height: doc.page.height });
  }

  const contentLeft = 90;
  const contentRight = doc.page.width - 90;
  let cursorY = 255;

  const infoWidth = 260;
  const infoX = contentLeft;
  doc.fontSize(10).fillColor('#0a1b3f');
  doc.text(`Invoice #: ${order.invoiceNumber}`, infoX, cursorY, {
    width: infoWidth,
    align: 'left',
  });
  doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`, infoX, doc.y, {
    width: infoWidth,
    align: 'left',
  });

  cursorY += 38;
  doc.fontSize(12).text('Customer', contentLeft, cursorY, { underline: true });
  doc.fontSize(10).text(order.customer?.name || '', contentLeft);
  doc.text(order.customer?.email || '');
  doc.text(order.customer?.phone || '');

  doc.moveDown();
  doc.fontSize(12).text('Shipping Address', { underline: true });
  doc.fontSize(10).text(order.shippingAddress?.fullName || '');
  doc.text(order.shippingAddress?.line1 || '');
  if (order.shippingAddress?.line2) doc.text(order.shippingAddress.line2);
  doc.text(order.shippingAddress?.city || '');
  doc.text(order.shippingAddress?.country || '');
  doc.text(order.shippingAddress?.postalCode || '');

  doc.moveDown();
  doc.fontSize(12).text('Items', { underline: true });
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
  doc.fontSize(11).text(`Subtotal: ${formatBhd(order.subtotal)}`, { align: 'right' });
  doc.text(`Shipping: ${formatBhd(order.shippingFee)}`, { align: 'right' });
  doc.fontSize(12).text(`Total: ${formatBhd(order.total)}`, { align: 'right' });

  doc.end();
  return doc;
};

module.exports = { buildInvoicePdf };
