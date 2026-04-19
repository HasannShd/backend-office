const { sendMail, isConfigured, getNotificationRecipient } = require('../utils/mailer');
const { escapeHtml, renderNotificationEmail } = require('../utils/notification-email');

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
    'Dear Madam,',
    '',
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
    `Attachments: ${(order.attachments || []).length ? (order.attachments || []).map((entry) => entry.url).join(' | ') : '-'}`,
    '',
    'Regards',
    'Leading Trading Team',
    'Operations Department',
  ].join('\n');

  const html = renderNotificationEmail({
    preheader: 'LTE Sales Order Notification',
    heading: 'New Sales Order Submitted',
    introLines: [
      'Dear Madam,',
      'A new sales order has been submitted and is ready for office review.',
    ],
    detailRows: [
      { label: 'Staff', value: staff?.name || staff?.username || '-' },
      { label: 'Email', value: staff?.email || '-' },
      { label: 'Phone', value: staff?.phone || '-' },
      { label: 'Submitted', value: order.submittedAt.toISOString() },
      { label: 'Client', value: order.customerName || '-' },
      { label: 'Company', value: order.companyName || '-' },
      { label: 'Contact Person', value: order.contactPerson || '-' },
      { label: 'Urgency', value: order.urgency || '-' },
      { label: 'Notes', value: order.notes || '-' },
      {
        label: 'Attachments',
        value: (order.attachments || []).length
          ? (order.attachments || []).map((entry) => entry.name || entry.url).join(' | ')
          : '-',
      },
    ],
    sectionTitle: 'Items',
    sectionBody: `
      <table style="width:100%; border-collapse:collapse; margin:0 0 18px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">Product</th>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">Quantity</th>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${order.items
            .map(
              (item) => `
                <tr>
                  <td style="padding:10px 12px; border:1px solid #d7e0ea;">${escapeHtml(item.productName || '-')}</td>
                  <td style="padding:10px 12px; border:1px solid #d7e0ea;">${item.quantity}</td>
                  <td style="padding:10px 12px; border:1px solid #d7e0ea;">${
                    item.price !== undefined && item.price !== null ? escapeHtml(formatCurrency(item.price)) : 'N/A'
                  }</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    `,
  });

  return { text, html };
};

const sendSalesOrderEmail = async ({ order, staff }) => {
  const to = getNotificationRecipient(
    'SALES_ORDER_NOTIFY_EMAIL',
    'ORDER_NOTIFY_EMAIL',
    'ATTENTION_NOTIFY_EMAIL',
    'HR_NOTIFY_EMAIL',
    'SMTP_FROM'
  );
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
