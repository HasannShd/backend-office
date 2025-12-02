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

    // attach fresh user object for downstream handlers
    req.user = user;

    next();
  } catch (err) {
    next(err);
  }
};
