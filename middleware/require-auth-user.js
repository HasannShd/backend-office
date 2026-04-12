const User = require('../models/user');
const verifyToken = require('./verify-token');

module.exports = async function requireAuthUser(req, res, next) {
  verifyToken(req, res, async () => {
    try {
      const user = await User.findById(req.user._id).select('-hashedPassword');
      if (!user) {
        return res.status(401).json({ ok: false, message: 'User not found.' });
      }

      if (user.isActive === false) {
        return res.status(403).json({ ok: false, message: 'This account is inactive.' });
      }

      if (req.tokenIssuedAt && user.passwordChangedAt && new Date(user.passwordChangedAt) > req.tokenIssuedAt) {
        return res.status(401).json({ ok: false, message: 'Session expired. Please sign in again.' });
      }

      req.authUser = user;
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  });
};
