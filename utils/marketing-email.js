const COMPANY_NAME = 'Leading Trading Est';
const COMPANY_EMAIL = process.env.COMPANY_EMAIL || 'admin@lte-bh.com';
const API_URL = (
  process.env.PUBLIC_API_URL ||
  process.env.API_PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.CLIENT_URL ||
  'https://www.lte-bh.com'
).replace(/\/+$/, '');

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getGreeting = (contact = {}) => {
  const contactName = String(contact.name || '').trim();
  const companyName = String(contact.companyName || '').trim();
  if (contactName) return `Dear ${contactName},`;
  if (companyName) return `Dear ${companyName} Team,`;
  return 'Dear Valued Client,';
};

const getClientReference = (contact = {}) => {
  const companyName = String(contact.companyName || '').trim();
  return companyName ? `your team at ${companyName}` : 'your team';
};

const buildUnsubscribeUrl = (token) => `${API_URL}/api/marketing/unsubscribe/${encodeURIComponent(token)}`;

const renderSocialFollowEmail = ({ contact, subject, previewText, instagramUrl, linkedinUrl }) => {
  const greeting = getGreeting(contact);
  const clientReference = getClientReference(contact);
  const unsubscribeUrl = buildUnsubscribeUrl(contact.unsubscribeToken);

  const text = [
    greeting,
    '',
    `We would like to stay connected with ${clientReference} through our official Leading Trading Est social pages, where we will share company news and general updates from our team.`,
    '',
    instagramUrl ? `Instagram: ${instagramUrl}` : '',
    linkedinUrl ? `LinkedIn: ${linkedinUrl}` : '',
    '',
    'We appreciate your continued trust and support, and we look forward to staying connected.',
    '',
    'Best regards,',
    `${COMPANY_NAME}`,
    COMPANY_EMAIL,
    '+973 17210665',
    'https://www.lte-bh.com',
    '',
    `To stop receiving these updates: ${unsubscribeUrl}`,
  ].filter(Boolean).join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f1eb;font-family:Arial,sans-serif;color:#102033;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText || 'A quick note from Leading Trading Est.')}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1eb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fffdf9;border:1px solid #e5ddd0;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 14px;">
                <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#a87744;font-weight:700;">${escapeHtml(COMPANY_NAME)}</div>
                <h1 style="margin:12px 0 0;font-size:26px;line-height:1.2;color:#102033;">${escapeHtml(subject)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 8px;font-size:15px;line-height:1.7;color:#344256;">
                <p style="margin:0 0 14px;">${escapeHtml(greeting)}</p>
                <p style="margin:0 0 16px;">We would like to stay connected with ${escapeHtml(clientReference)} through our official Leading Trading Est social pages, where we will share company news and general updates from our team.</p>
                <p style="margin:0;">Follow our official pages below.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 26px;">
                ${instagramUrl ? `<a href="${escapeHtml(instagramUrl)}" style="display:inline-block;margin:0 10px 10px 0;padding:13px 18px;border-radius:999px;background:#a87744;color:#ffffff;text-decoration:none;font-weight:700;">Follow on Instagram</a>` : ''}
                ${linkedinUrl ? `<a href="${escapeHtml(linkedinUrl)}" style="display:inline-block;margin:0 10px 10px 0;padding:13px 18px;border-radius:999px;background:#0a66c2;color:#ffffff;text-decoration:none;font-weight:700;">Follow on LinkedIn</a>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f8f4ed;font-size:12px;line-height:1.6;color:#687383;">
                <p style="margin:0 0 12px;color:#344256;font-size:14px;">We appreciate your continued trust and support, and we look forward to staying connected.</p>
                <p style="margin:0 0 6px;"><strong>${escapeHtml(COMPANY_NAME)}</strong></p>
                <p style="margin:0 0 8px;"><a href="mailto:${escapeHtml(COMPANY_EMAIL)}" style="color:#1d4f91;">${escapeHtml(COMPANY_EMAIL)}</a> · +973 17210665 · <a href="https://www.lte-bh.com" style="color:#1d4f91;">www.lte-bh.com</a></p>
                <p style="margin:10px 0 0;font-size:11px;color:#8a95a4;">To stop receiving these updates, <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7480;">unsubscribe here</a>.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { text, html, unsubscribeUrl };
};

module.exports = {
  buildUnsubscribeUrl,
  renderSocialFollowEmail,
};
