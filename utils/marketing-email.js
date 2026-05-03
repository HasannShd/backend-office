const COMPANY_NAME = 'Leading Trading Est';
const COMPANY_ADDRESS = 'Warehousing World, Um Al-Baidh, Sitra, Bahrain';
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
    `We would like to stay connected with ${clientReference} through Leading Trading Est updates, product highlights, and sourcing news.`,
    '',
    instagramUrl ? `Instagram: ${instagramUrl}` : '',
    linkedinUrl ? `LinkedIn: ${linkedinUrl}` : '',
    '',
    `You are receiving this because your email is listed with ${COMPANY_NAME} for business communication.`,
    `Unsubscribe from future marketing emails: ${unsubscribeUrl}`,
    '',
    `${COMPANY_NAME}`,
    COMPANY_ADDRESS,
    COMPANY_EMAIL,
  ].filter(Boolean).join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f1eb;font-family:Arial,sans-serif;color:#102033;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText || 'Follow Leading Trading Est for product and sourcing updates.')}</div>
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
                <p style="margin:0 0 16px;">We would like to stay connected with ${escapeHtml(clientReference)} through LTE product updates, sourcing news, and company announcements for Bahrain medical, dental, and industrial supply.</p>
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
                <p style="margin:0 0 8px;">You are receiving this business update because your email is listed with ${escapeHtml(COMPANY_NAME)}.</p>
                <p style="margin:0 0 8px;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#1d4f91;">Unsubscribe from future marketing emails</a></p>
                <p style="margin:0;">${escapeHtml(COMPANY_NAME)} · ${escapeHtml(COMPANY_ADDRESS)} · <a href="mailto:${escapeHtml(COMPANY_EMAIL)}" style="color:#1d4f91;">${escapeHtml(COMPANY_EMAIL)}</a></p>
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
