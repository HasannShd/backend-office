const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const buildInvoicePdf = (order) => {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  const templatePath = path.join(__dirname, '..', 'invoice template.jpeg');
  if (fs.existsSync(templatePath)) {
    doc.image(templatePath, 0, 0, { width: doc.page.width, height: doc.page.height });
  }

  const contentLeft = 78;
  const contentRight = doc.page.width - 78;
  const textColor = '#0a1b3f';
  doc.fillColor(textColor);

  const deliveryNoteNo = order.invoiceNumber || '';
  const refNo = order.invoiceNumber || '';
  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString() : '';

  doc.fontSize(9);
  doc.text(`Delivery Note No. ${deliveryNoteNo}`, contentLeft + 8, 176);
  doc.text(`Ref. No. ${refNo}`, contentLeft + 8, 190);
  doc.text(`Dated ${orderDate}`, contentRight - 140, 176, { width: 130, align: 'right' });

  const partyName = order.shippingAddress?.fullName || order.customer?.name || '';
  const partyLine1 = order.shippingAddress?.line1 || '';
  const partyLine2 = order.shippingAddress?.line2 || '';
  const partyCity = order.shippingAddress?.city || '';
  const partyCountry = order.shippingAddress?.country || '';
  const partyPhone = order.shippingAddress?.phone || order.customer?.phone || '';

  let partyY = 258;
  const partyX = contentLeft + 90;
  const partyWidth = 260;
  doc.fontSize(9);
  doc.text(partyName, partyX, partyY, { width: partyWidth });
  partyY = doc.y + 2;
  if (partyLine1) {
    doc.text(partyLine1, partyX, partyY, { width: partyWidth });
    partyY = doc.y + 2;
  }
  if (partyLine2) {
    doc.text(partyLine2, partyX, partyY, { width: partyWidth });
    partyY = doc.y + 2;
  }
  if (partyCity || partyCountry) {
    doc.text([partyCity, partyCountry].filter(Boolean).join(', '), partyX, partyY, { width: partyWidth });
    partyY = doc.y + 2;
  }
  if (partyPhone) {
    doc.text(partyPhone, partyX, partyY, { width: partyWidth });
  }

  const tableTopY = 362;
  const slNoX = contentLeft + 2;
  const descX = contentLeft + 52;
  const qtyX = contentRight - 74;
  const descWidth = qtyX - descX - 10;
  const qtyWidth = 70;
  let cursorY = tableTopY;

  doc.fontSize(9);
  order.items.forEach((item, index) => {
    if (cursorY > 640) {
      doc.addPage();
      if (fs.existsSync(templatePath)) {
        doc.image(templatePath, 0, 0, { width: doc.page.width, height: doc.page.height });
      }
      doc.fillColor(textColor);
      cursorY = tableTopY;
    }

    const description = `${item.name}${item.size ? ` ${item.size}` : ''}`;
    const descHeight = doc.heightOfString(description, { width: descWidth });
    const rowHeight = Math.max(descHeight, 12) + 6;

    doc.text(String(index + 1), slNoX, cursorY, { width: 30 });
    doc.text(description, descX, cursorY, { width: descWidth });
    doc.text(`${item.quantity} Pcs`, qtyX, cursorY, { width: qtyWidth, align: 'right' });

    cursorY += rowHeight;
  });

  const totalQty = order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  doc.fontSize(9).text(`Total ${totalQty} Pcs`, qtyX - 20, 640, {
    width: qtyWidth + 40,
    align: 'right',
  });

  doc.end();
  return doc;
};

module.exports = { buildInvoicePdf };
