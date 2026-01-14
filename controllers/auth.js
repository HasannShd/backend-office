const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('../models/user');

const verifyToken = require('../middleware/verify-token');

const saltRounds = 12;

const buildPayload = (user) => ({
  username: user.username,
  _id: user._id,
  role: user.role,
});

const findUserByIdentifier = async (identifier) => {
  if (!identifier) return null;
  return User.findOne({
    $or: [{ username: identifier }, { email: identifier }, { phone: identifier }],
  });
};

const normalizeUsername = (email, username) => {
  if (username && username.trim()) return username.trim();
  return email.trim().toLowerCase();
};

const signUpHandler = async (req, res) => {
  try {
    const { username, email, phone, password, name, marketingOptIn } = req.body;
    if (!email || !phone || !password) {
      return res.status(400).json({ err: 'Email, phone, and password are required.' });
    }

    const normalizedUsername = normalizeUsername(email, username);
    const userInDatabase = await User.findOne({
      $or: [{ username: normalizedUsername }, { email }, { phone }],
    });
    
    if (userInDatabase) {
      return res.status(409).json({ err: 'User already exists.' });
    }
    
    const user = await User.create({
      username: normalizedUsername,
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      name,
      marketingOptIn: !!marketingOptIn,
      hashedPassword: bcrypt.hashSync(password, saltRounds),
    });

    const payload = buildPayload(user);

    const token = jwt.sign({ payload }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ token });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};

const signInHandler = async (req, res) => {
  try {
    const identifier = req.body.identifier || req.body.username || req.body.email;
    const { password } = req.body;
    const user = await findUserByIdentifier(identifier);
    if (!user) {
      return res.status(401).json({ err: 'Invalid credentials.' });
    }

    const isPasswordCorrect = bcrypt.compareSync(
      password, user.hashedPassword
    );
    if (!isPasswordCorrect) {
      return res.status(401).json({ err: 'Invalid credentials.' });
    }

    const payload = buildPayload(user);

    const token = jwt.sign({ payload }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(200).json({ token });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};

router.post('/sign-up', signUpHandler);
router.post('/register', signUpHandler);
router.post('/sign-in', signInHandler);
router.post('/login', signInHandler);

// Get current logged-in user
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-hashedPassword');
    if (!user) return res.status(404).json({ err: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

module.exports = router;
