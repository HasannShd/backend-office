const { sendMail, isConfigured } = require('../utils/mailer');

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return `${Number(value).toFixed(2)} BHD`;
};

const buildOrderEmail = ({ order, staff }) => {
  const lines = order.items.map((item, index) => {
    const unitPrice = item.price !== undefined && item.price !== null ? formatCurrency(item.price) : 'N/A';
    return `${index + 1}. ${item.productName} | Qty: ${item.quantity} | Price: ${unitPrice}`;
  });

  const text = [
    'New sales order submitted',
    '',
    `Staff: ${staff?.name || staff?.username || '-'}`,
    `Email: ${staff?.email || '-'}`,
    `Phone: ${staff?.phone || '-'}`,
    `Submitted: ${order.submittedAt.toISOString()}`,
    '',
    `Client: ${order.customerName || '-'}`,
    `Company: ${order.companyName || '-'}`,
    `Contact person: ${order.contactPerson || '-'}`,
    `Urgency: ${order.urgency || '-'}`,
    '',
    'Items:',
    ...lines,
    '',
    `Notes: ${order.notes || '-'}`,
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>New Sales Order Submitted</h2>
      <p><strong>Staff:</strong> ${staff?.name || staff?.username || '-'}</p>
      <p><strong>Email:</strong> ${staff?.email || '-'}</p>
      <p><strong>Phone:</strong> ${staff?.phone || '-'}</p>
      <p><strong>Submitted:</strong> ${order.submittedAt.toISOString()}</p>
      <hr />
      <p><strong>Client:</strong> ${order.customerName || '-'}</p>
      <p><strong>Company:</strong> ${order.companyName || '-'}</p>
      <p><strong>Contact person:</strong> ${order.contactPerson || '-'}</p>
      <p><strong>Urgency:</strong> ${order.urgency || '-'}</p>
      <h3>Items</h3>
      <ul>${order.items
        .map(
          (item) =>
            `<li>${item.productName} | Qty: ${item.quantity} | Price: ${
              item.price !== undefined && item.price !== null ? formatCurrency(item.price) : 'N/A'
            }</li>`
        )
        .join('')}</ul>
      <p><strong>Notes:</strong> ${order.notes || '-'}</p>
    </div>
  `;

  return { text, html };
};

const sendSalesOrderEmail = async ({ order, staff }) => {
  const to = process.env.SALES_ORDER_NOTIFY_EMAIL || process.env.ORDER_NOTIFY_EMAIL || process.env.SMTP_FROM;
  if (!to) {
    return { sent: false, skipped: true, reason: 'No destination email configured.' };
  }

  const { text, html } = buildOrderEmail({ order, staff });

  if (!isConfigured) {
    return { sent: false, skipped: true, reason: 'SMTP not configured.' };
  }

  await sendMail({
    to,
    subject: `LTE Sales Order | ${order.companyName || order.customerName || 'New submission'}`,
    text,
    html,
  });

  return { sent: true, skipped: false };
};

const createTallyBridgePayload = ({ order }) => ({
  mode: 'email_only',
  tallySyncStatus: 'not_configured',
  orderId: order._id,
});

module.exports = { sendSalesOrderEmail, createTallyBridgePayload };
