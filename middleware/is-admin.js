const User = require('../models/user');

module.exports = async function isAdmin(req, res, next) {
  try {
    if (!req.user || !req.user._id) {
      return res.status(403).json({ message: 'Admin access only' });
    }

    // Re-fetch user from DB to ensure role is current (don't trust stale tokens)
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access only' });
    }

    const enforceAdminMfa = process.env.ENFORCE_ADMIN_MFA !== 'false';
    if (enforceAdminMfa && (!user.mfaEnabled || !user.mfaSecretEncrypted)) {
      return res.status(428).json({
        message: 'Admin MFA setup is required before using this section.',
        code: 'ADMIN_MFA_REQUIRED',
      });
    }

    // attach fresh user object for downstream handlers
    req.user = user;

    next();
  } catch (err) {
    next(err);
  }
};
