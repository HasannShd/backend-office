const PRIVATE_API_PREFIXES = [
  '/api/admin-portal',
  '/api/staff-portal',
  '/api/users',
  '/api/marketing',
  '/api/orders',
  '/api/cart',
  '/api/auth',
];

const hasUnsafeKey = (value) => {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some((key) => (
    key.startsWith('$') ||
    key.includes('.') ||
    hasUnsafeKey(value[key])
  ));
};

const rejectUnsafeMongoKeys = (req, res, next) => {
  if (hasUnsafeKey(req.body) || hasUnsafeKey(req.query) || hasUnsafeKey(req.params)) {
    return res.status(400).json({ ok: false, message: 'Invalid request payload.' });
  }
  return next();
};

const privateDataHeaders = (req, res, next) => {
  const isPrivateApi = PRIVATE_API_PREFIXES.some((prefix) => req.path.startsWith(prefix));
  if (isPrivateApi) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return next();
};

module.exports = {
  privateDataHeaders,
  rejectUnsafeMongoKeys,
};
