const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  try {
    if (!req.headers.authorization) {
      return res.status(401).json({ err: 'No token provided.' });
    }
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    req.user = decoded.payload;
    
    next();
  } catch (err) {
    res.status(401).json({ err: 'Invalid token.' });
  }
}

module.exports = verifyToken;
