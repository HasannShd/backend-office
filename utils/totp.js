const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_WINDOW = 1;
const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;

const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
};

const base32Decode = (input) => {
  const normalized = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
};

const generateSecret = () => base32Encode(crypto.randomBytes(20));

const hotp = (secret, counter, digits = TOTP_DIGITS) => {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % (10 ** digits)).padStart(digits, '0');
};

const totp = (secret, time = Date.now(), period = TOTP_PERIOD, digits = TOTP_DIGITS) => {
  const counter = Math.floor(time / 1000 / period);
  return hotp(secret, counter, digits);
};

const verifyTotp = (secret, token, window = TOTP_WINDOW) => {
  const normalizedToken = String(token || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalizedToken)) return false;
  const now = Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    if (totp(secret, now + offset * TOTP_PERIOD * 1000) === normalizedToken) {
      return true;
    }
  }
  return false;
};

const buildOtpAuthUrl = ({ secret, accountName, issuer = 'LTE Admin' }) => {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};

const generateBackupCodes = (count = 10) =>
  Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,4}/g).join('-')
  );

module.exports = {
  buildOtpAuthUrl,
  generateBackupCodes,
  generateSecret,
  verifyTotp,
};
