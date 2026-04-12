const crypto = require('crypto');

const USER_COOKIE = 'lte_user_token';
const STAFF_COOKIE = 'lte_staff_token';
const ADMIN_COOKIE = 'lte_admin_token';
const MFA_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MFA_CHALLENGE_PURPOSE = 'admin-mfa';

const COOKIE_NAMES = {
  user: USER_COOKIE,
  sales_staff: STAFF_COOKIE,
  admin: ADMIN_COOKIE,
};

const TOKEN_TTLS = {
  user: '3d',
  sales_staff: '1d',
  admin: '8h',
};

const COOKIE_MAX_AGE_MS = {
  user: 3 * 24 * 60 * 60 * 1000,
  sales_staff: 24 * 60 * 60 * 1000,
  admin: 8 * 60 * 60 * 1000,
};

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;

const parseCookieHeader = (cookieHeader = '') =>
  String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return acc;
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});

const getScopeCookieName = (scope) => {
  if (!scope) return null;
  return COOKIE_NAMES[String(scope).trim()] || null;
};

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, token] = authHeader.split(' ');
    if (scheme === 'Bearer' && token) return token;
  }

  const cookies = parseCookieHeader(req.headers.cookie);
  const requestedScope = req.headers['x-auth-scope'];
  const scopedCookie = getScopeCookieName(requestedScope);
  if (scopedCookie && cookies[scopedCookie]) return cookies[scopedCookie];

  return cookies[ADMIN_COOKIE] || cookies[STAFF_COOKIE] || cookies[USER_COOKIE] || null;
};

const buildCookieOptions = (role) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const sameSite = process.env.AUTH_COOKIE_SAME_SITE || (isProduction ? 'none' : 'lax');
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    maxAge: COOKIE_MAX_AGE_MS[role] || COOKIE_MAX_AGE_MS.user,
    path: '/',
  };
};

const setAuthCookie = (res, user, token) => {
  const cookieName = COOKIE_NAMES[user.role] || USER_COOKIE;
  res.cookie(cookieName, token, buildCookieOptions(user.role));
  return cookieName;
};

const clearAuthCookies = (res) => {
  Object.entries(COOKIE_NAMES).forEach(([, cookieName]) => {
    res.clearCookie(cookieName, buildCookieOptions('user'));
  });
};

const validatePasswordStrength = (password) => {
  const value = String(password || '');
  if (value.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-z]/.test(value)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(value)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include a special character.';
  return null;
};

const getMfaEncryptionKey = () =>
  crypto.createHash('sha256').update(String(process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET || '')).digest();

const encryptSecret = (plainText) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMfaEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

const decryptSecret = (payload) => {
  if (!payload) return '';
  const [ivHex, tagHex, dataHex] = String(payload).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getMfaEncryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
};

const isUserLocked = (user) => Boolean(user?.lockedUntil && new Date(user.lockedUntil) > new Date());

const registerFailedLoginAttempt = async (user) => {
  user.failedLoginAttempts = Number(user.failedLoginAttempts || 0) + 1;
  user.lastFailedLoginAt = new Date();
  if (user.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    user.lockedUntil = new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000);
  }
  await user.save();
  return isUserLocked(user);
};

const clearFailedLoginState = async (user) => {
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastFailedLoginAt = undefined;
  await user.save();
};

module.exports = {
  MFA_CHALLENGE_TTL_MS,
  MFA_CHALLENGE_PURPOSE,
  TOKEN_TTLS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOGIN_LOCK_MINUTES,
  clearAuthCookies,
  clearFailedLoginState,
  decryptSecret,
  encryptSecret,
  getTokenFromRequest,
  setAuthCookie,
  validatePasswordStrength,
  isUserLocked,
  registerFailedLoginAttempt,
};
