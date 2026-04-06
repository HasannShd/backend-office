module.exports = (...allowedRoles) => (req, res, next) => {
  const role = req.user?.role || req.authUser?.role;
  if (!role || !allowedRoles.includes(role)) {
    return res.status(403).json({
      ok: false,
      message: 'You do not have access to this resource.',
    });
  }

  return next();
};
