const { sendMail, isConfigured, getNotificationRecipient } = require('../utils/mailer');
const { escapeHtml, renderNotificationEmail } = require('../utils/notification-email');

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return `${Number(value).toFixed(2)} BHD`;
};
const formatQuantity = (item) => {
  const quantity = item.quantity ?? 0;
  const hasExplicitStructure = Boolean(
    item.uom || item.vatApplicable || (item.price !== undefined && item.price !== null)
  );
  return quantity === 1 && !hasExplicitStructure ? '-' : `${quantity}${item.uom ? ` ${item.uom}` : ''}`;
};
const attachmentLabel = (entry, index) => entry?.name || entry?.url?.split('/').pop() || `Attachment ${index + 1}`;

const buildOrderEmail = ({ order, staff }) => {
  const lines = order.items.map((item, index) => {
    const unitPrice = item.price !== undefined && item.price !== null ? formatCurrency(item.price) : 'N/A';
    const vatText = item.vatApplicable ? ` | VAT: ${item.vatAmount ?? 'Yes'}` : '';
    return `${index + 1}. ${item.productName} | Qty: ${formatQuantity(item)}${vatText} | Price: ${unitPrice}`;
  });

  const text = [
    'Dear Admin,',
    '',
    'New sales order submitted',
    '',
    `Staff to Admin: ${staff?.name || staff?.username || '-'}`,
    `Email: ${staff?.email || '-'}`,
    `Phone: ${staff?.phone || '-'}`,
    `Submitted: ${order.submittedAt.toISOString()}`,
    `Requested for date: ${order.requestedForDate || '-'}`,
    `Order timing: ${order.orderTiming || 'today'}`,
    '',
    `Facility: ${order.companyName || order.client?.name || '-'}`,
    `Contact person: ${order.contactPerson || '-'}`,
    `Urgency: ${order.urgency || '-'}`,
    `VAT applicable: ${order.vatApplicable ? 'Yes' : 'No'}`,
    `VAT amount: ${order.vatAmount ?? '-'}`,
    '',
    'Items:',
    ...lines,
    '',
    `Notes: ${order.notes || '-'}`,
    `Attachments: ${(order.attachments || []).length ? (order.attachments || []).map((entry, index) => `${attachmentLabel(entry, index)}: ${entry.url}`).join(' | ') : '-'}`,
    '',
    'Regards',
    'Staff to Admin',
  ].join('\n');

  const html = renderNotificationEmail({
    preheader: 'LTE Sales Order Notification',
    heading: 'New Sales Order Submitted',
    introLines: [
      'Dear Admin,',
      'A new sales order has been submitted and is ready for office review.',
    ],
    detailRows: [
      { label: 'Staff to Admin', value: staff?.name || staff?.username || '-' },
      { label: 'Email', value: staff?.email || '-' },
      { label: 'Phone', value: staff?.phone || '-' },
      { label: 'Submitted', value: order.submittedAt.toISOString() },
      { label: 'Requested For', value: order.requestedForDate || '-' },
      { label: 'Order Timing', value: order.orderTiming || 'today' },
      { label: 'Facility', value: order.companyName || order.client?.name || '-' },
      { label: 'Contact Person', value: order.contactPerson || '-' },
      { label: 'Urgency', value: order.urgency || '-' },
      { label: 'VAT Applicable', value: order.vatApplicable ? 'Yes' : 'No' },
      { label: 'VAT Amount', value: order.vatAmount ?? '-' },
      { label: 'Notes', value: order.notes || '-' },
    ],
    sectionTitle: 'Items',
    sectionBody: `
      <table style="width:100%; border-collapse:collapse; margin:0 0 18px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">Product</th>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">Quantity</th>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">UOM</th>
            <th style="text-align:left; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; color:#123a66;">VAT</th>
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
                  <td style="padding:10px 12px; border:1px solid #d7e0ea;">${escapeHtml(item.uom || '-')}</td>
                  <td style="padding:10px 12px; border:1px solid #d7e0ea;">${escapeHtml(item.vatApplicable ? String(item.vatAmount ?? 'Yes') : 'No')}</td>
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
    attachmentItems: (order.attachments || []).map((entry, index) => ({
      label: attachmentLabel(entry, index),
      href: entry.url,
    })),
    signoffName: 'Staff to Admin',
    signoffRole: '',
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
  const mailAttachments = (order.attachments || [])
    .filter((entry) => entry?.url)
    .map((entry, index) => ({
      filename: attachmentLabel(entry, index),
      path: entry.url,
      contentType: entry.mimeType || undefined,
    }));

  if (!isConfigured) {
    return { sent: false, skipped: true, reason: 'SMTP not configured.' };
  }

  await sendMail({
    to,
    subject: `LTE Sales Order | ${order.companyName || order.client?.name || order.customerName || 'New submission'}`,
    text,
    html,
    attachments: mailAttachments,
  });

  return { sent: true, skipped: false };
};

const createTallyBridgePayload = ({ order }) => ({
  mode: 'email_only',
  tallySyncStatus: 'not_configured',
  orderId: order._id,
});

module.exports = { sendSalesOrderEmail, createTallyBridgePayload };
