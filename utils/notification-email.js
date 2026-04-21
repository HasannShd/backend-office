const COMPANY_NAME = process.env.COMPANY_NAME || 'Leading Trading Est.';
const COMPANY_ADDRESS_LINE_1 = process.env.COMPANY_ADDRESS_LINE_1 || 'Office 109, Warehousing World, Um-al-Baidh';
const COMPANY_ADDRESS_LINE_2 = process.env.COMPANY_ADDRESS_LINE_2 || 'Opp. Al-Bander Resort, Sitra - Kingdom of Bahrain.';
const COMPANY_PHONE_LINE = process.env.COMPANY_PHONE_LINE || 'Tel:+973 17210665, Fax:+973-17210973, Mobile: +973-33708928';
const COMPANY_EMAIL = process.env.COMPANY_EMAIL || 'leadingtrading1@gmail.com';
const COMPANY_WEBSITE = process.env.COMPANY_WEBSITE || 'www.lte-bh.com';
const COMPANY_LOGO_URL = process.env.COMPANY_LOGO_URL || 'https://www.lte-bh.com/favicon.ico';
const DEFAULT_SIGNOFF_NAME = process.env.NOTIFICATION_SIGNOFF_NAME || 'Leading Trading Team';
const DEFAULT_SIGNOFF_ROLE = process.env.NOTIFICATION_SIGNOFF_ROLE || 'Operations Department';

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const normalizeLines = (lines = []) =>
  lines
    .map((line) => String(line || '').trim())
    .filter(Boolean);

const renderKeyValueTable = (rows = []) => {
  const safeRows = rows.filter((row) => row && row.label);
  if (!safeRows.length) return '';

  return `
    <table style="width:100%; border-collapse:collapse; margin:0 0 18px;">
      ${safeRows
        .map(
          (row) => `
            <tr>
              <td style="width:180px; padding:10px 12px; border:1px solid #d7e0ea; background:#f6f9fc; font-weight:700; color:#123a66;">${escapeHtml(row.label)}</td>
              <td style="padding:10px 12px; border:1px solid #d7e0ea; color:#1f2d3d;">${escapeHtml(row.value ?? '-')}</td>
            </tr>
          `
        )
        .join('')}
    </table>
  `;
};

const renderBullets = (items = []) => {
  const safeItems = items.filter(Boolean);
  if (!safeItems.length) return '';

  return `
    <ul style="margin:0 0 18px; padding-left:20px; color:#1f2d3d;">
      ${safeItems.map((item) => `<li style="margin:0 0 8px;">${item}</li>`).join('')}
    </ul>
  `;
};

const renderAttachmentList = (items = []) => {
  const safeItems = items.filter((item) => item && item.label && item.href);
  if (!safeItems.length) return '';

  return `
    <div style="margin:0 0 18px;">
      ${safeItems
        .map(
          (item) => `
            <div style="margin:0 0 10px; padding:12px 14px; border:1px solid #d7e0ea; border-radius:12px; background:#f8fbff; word-break:break-word;">
              <a href="${escapeHtml(item.href)}" style="color:#1d4f91; font-weight:600; text-decoration:none;">${escapeHtml(item.label)}</a>
            </div>
          `
        )
        .join('')}
    </div>
  `;
};

const renderFooter = ({ signoffName = DEFAULT_SIGNOFF_NAME, signoffRole = DEFAULT_SIGNOFF_ROLE } = {}) => `
  <div style="margin-top:28px; color:#234d80;">
    <div style="margin-bottom:18px;">Regards</div>
    <div style="margin-bottom:10px; font-weight:700;">${escapeHtml(signoffName)}</div>
    ${signoffRole ? `<div style="margin-bottom:18px;">${escapeHtml(signoffRole)}</div>` : '<div style="margin-bottom:18px;"></div>'}
    <table role="presentation" style="border-collapse:collapse; margin:0 0 14px;">
      <tr>
        <td style="vertical-align:middle; padding:0 14px 0 0;">
          <img src="${escapeHtml(COMPANY_LOGO_URL)}" alt="LTE" style="display:block; width:72px; height:72px; object-fit:contain; border-radius:10px; background:#ffffff;" />
        </td>
        <td style="vertical-align:middle;">
          <div style="font-weight:800; font-size:16px; color:#123a66;">${escapeHtml(COMPANY_NAME)}</div>
        </td>
      </tr>
    </table>
    <div style="color:#234d80; line-height:1.65;">
      <div>${escapeHtml(COMPANY_ADDRESS_LINE_1)}</div>
      <div>${escapeHtml(COMPANY_ADDRESS_LINE_2)}</div>
      <div>${escapeHtml(COMPANY_PHONE_LINE)}</div>
      <div>Email: <a href="mailto:${escapeHtml(COMPANY_EMAIL)}" style="color:#1d4f91;">${escapeHtml(COMPANY_EMAIL)}</a></div>
      <div>Website: <a href="https://${escapeHtml(COMPANY_WEBSITE)}" style="color:#1d4f91;">${escapeHtml(COMPANY_WEBSITE)}</a></div>
    </div>
  </div>
`;

const renderNotificationEmail = ({
  preheader = '',
  heading,
  introLines = [],
  detailRows = [],
  sectionTitle = '',
  sectionBody = '',
  attachmentItems = [],
  bulletItems = [],
  footerNote = '',
  signoffName,
  signoffRole,
}) => `
  <div style="margin:0; padding:24px; background:#eef3f8; font-family:Arial, Helvetica, sans-serif; color:#1f2d3d;">
    <div style="max-width:760px; margin:0 auto; background:#ffffff; border:1px solid #d7e0ea; border-radius:18px; overflow:hidden;">
      <div style="padding:22px 28px; background:linear-gradient(135deg, #0f4c81, #1c73b8); color:#ffffff;">
        <div style="font-size:12px; letter-spacing:0.08em; text-transform:uppercase; opacity:0.9;">${escapeHtml(preheader || COMPANY_NAME)}</div>
        <h1 style="margin:8px 0 0; font-size:26px; line-height:1.25;">${escapeHtml(heading)}</h1>
      </div>
      <div style="padding:28px;">
        ${normalizeLines(introLines).map((line) => `<p style="margin:0 0 18px; line-height:1.7;">${escapeHtml(line)}</p>`).join('')}
        ${renderKeyValueTable(detailRows)}
        ${sectionTitle ? `<h2 style="margin:24px 0 10px; font-size:18px; color:#123a66;">${escapeHtml(sectionTitle)}</h2>` : ''}
        <div style="margin:0 0 18px; word-break:break-word; overflow-wrap:anywhere;">
          ${sectionBody}
        </div>
        ${attachmentItems.length ? `<h2 style="margin:24px 0 10px; font-size:18px; color:#123a66;">Attachments</h2>` : ''}
        ${renderAttachmentList(attachmentItems)}
        ${renderBullets(bulletItems)}
        ${footerNote ? `<p style="margin:0 0 18px; line-height:1.7;">${escapeHtml(footerNote)}</p>` : ''}
        ${renderFooter({ signoffName, signoffRole })}
      </div>
    </div>
  </div>
`;

module.exports = {
  escapeHtml,
  renderNotificationEmail,
};
