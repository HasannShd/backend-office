const jwt = require('jsonwebtoken');
const { getTokenFromRequest } = require('../utils/auth-security');

function verifyToken(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ err: 'No token provided.' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    req.user = decoded.payload;
    req.tokenIssuedAt = decoded.iat ? new Date(decoded.iat * 1000) : null;
    
    next();
  } catch (err) {
    res.status(401).json({ err: 'Invalid token.' });
  }
}

module.exports = verifyToken;
