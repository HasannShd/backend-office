const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/user');
const { sendMail, isConfigured: isMailerConfigured } = require('../utils/mailer');
const { logActivity } = require('../services/activity-log-service');
const {
  TOKEN_TTLS,
  clearAuthCookies,
  clearFailedLoginState,
  isUserLocked,
  registerFailedLoginAttempt,
  setAuthCookie,
  validatePasswordStrength,
} = require('../utils/auth-security');

const verifyToken = require('../middleware/verify-token');

const saltRounds = 12;

const buildPayload = (user) => ({
  username: user.username,
  _id: user._id,
  role: user.role,
  isActive: user.isActive,
});

const findUserByIdentifier = async (identifier) => {
  if (!identifier) return null;
  const normalizedIdentifier = String(identifier).trim();
  const normalizedEmailIdentifier = normalizedIdentifier.toLowerCase();
  return User.findOne({
    $or: [
      { username: normalizedIdentifier },
      { email: normalizedEmailIdentifier },
      { phone: normalizedIdentifier },
    ],
  });
};

const normalizeUsername = (email, username) => {
  if (username && username.trim()) return username.trim();
  return email.trim().toLowerCase();
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const normalizePhone = (phone) => String(phone || '').trim();
const hashResetToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const signSessionToken = (user) =>
  jwt.sign({ payload: buildPayload(user) }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTLS[user.role] || TOKEN_TTLS.user });

const signUpHandler = async (req, res) => {
  try {
    const { username, email, phone, password, name, marketingOptIn } = req.body;
    if (!email || !phone || !password) {
      return res.status(400).json({ err: 'Email, phone, and password are required.' });
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return res.status(400).json({ err: passwordError });
    }

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);
    const normalizedUsername = normalizeUsername(normalizedEmail, username);
    const userInDatabase = await User.findOne({
      $or: [{ username: normalizedUsername }, { email: normalizedEmail }, { phone: normalizedPhone }],
    });
    
    if (userInDatabase) {
      return res.status(409).json({ err: 'User already exists.' });
    }
    
    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      phone: normalizedPhone,
      name,
      marketingOptIn: !!marketingOptIn,
      hashedPassword: bcrypt.hashSync(password, saltRounds),
      passwordChangedAt: new Date(),
    });

    const token = signSessionToken(user);
    setAuthCookie(res, user, token);

    await logActivity({
      user,
      action: 'sign_up',
      module: 'auth',
      recordId: user._id,
      metadata: { role: user.role },
    });

    res.status(201).json({ user: buildPayload(user) });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};

const signInHandler = async (req, res) => {
  try {
    const rawIdentifier = req.body.identifier || req.body.username || req.body.email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : rawIdentifier;
    const { password } = req.body;
    const user = await findUserByIdentifier(identifier);
    if (!user) {
      return res.status(401).json({ err: 'Invalid credentials.' });
    }

    if (isUserLocked(user)) {
      await logActivity({
        user,
        action: 'login_blocked',
        module: 'auth',
        recordId: user._id,
        metadata: { lockedUntil: user.lockedUntil },
      });
      return res.status(423).json({ err: 'Too many failed login attempts. Try again later.' });
    }

    const isPasswordCorrect = bcrypt.compareSync(
      password, user.hashedPassword
    );
    if (!isPasswordCorrect) {
      const locked = await registerFailedLoginAttempt(user);
      await logActivity({
        user,
        action: 'login_failed',
        module: 'auth',
        recordId: user._id,
        metadata: { failedLoginAttempts: user.failedLoginAttempts, locked },
      });
      if (locked) {
        return res.status(423).json({ err: 'Too many failed login attempts. Try again later.' });
      }
      return res.status(401).json({ err: 'Invalid credentials.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ err: 'This account has been deactivated.' });
    }

    await clearFailedLoginState(user);

    const token = signSessionToken(user);
    setAuthCookie(res, user, token);
    user.lastLoginAt = new Date();
    await user.save();

    await logActivity({
      user,
      action: 'login_success',
      module: 'auth',
      recordId: user._id,
      metadata: { role: user.role },
    });

    res.status(200).json({ user: buildPayload(user) });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};

router.post('/sign-up', signUpHandler);
router.post('/register', signUpHandler);
router.post('/sign-in', signInHandler);
router.post('/login', signInHandler);

router.post('/admin/forgot-password', async (req, res) => {
  try {
    const identifier = String(req.body.identifier || '').trim();
    const appUrl = String(req.body.appUrl || '').trim();

    if (!identifier) {
      return res.status(400).json({ err: 'Email or username is required.' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user || user.role !== 'admin' || !user.email) {
      return res.status(200).json({ message: 'If an admin account matches, a reset link has been sent.' });
    }

    if (!isMailerConfigured) {
      return res.status(503).json({ err: 'Password reset email is not configured on the server.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordTokenHash = hashResetToken(resetToken);
    user.resetPasswordExpiresAt = new Date(Date.now() + 1000 * 60 * 30);
    await user.save();

    const defaultAppUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}${appUrl.startsWith('http') ? '' : '/admin/login'}`;
    const baseUrl = appUrl || defaultAppUrl;
    const separator = baseUrl.includes('?') ? '&' : '?';
    const resetLink = `${baseUrl}${separator}resetToken=${encodeURIComponent(resetToken)}`;

    const subject = 'Admin password reset';
    const text = [
      `Hello ${user.name || user.username},`,
      '',
      'A password reset was requested for your admin account.',
      `Reset link: ${resetLink}`,
      '',
      'This link will expire in 30 minutes.',
      'If you did not request this, you can ignore this email.',
    ].join('\n');

    const html = `
      <div style="font-family: Arial, sans-serif; color: #13273f; line-height: 1.6;">
        <h2 style="margin-bottom: 8px;">Admin password reset</h2>
        <p>Hello ${user.name || user.username},</p>
        <p>A password reset was requested for your admin account.</p>
        <p>
          <a href="${resetLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#c88b48;color:#ffffff;text-decoration:none;font-weight:700;">
            Reset admin password
          </a>
        </p>
        <p style="word-break: break-all;">If the button does not open, use this link:<br />${resetLink}</p>
        <p>This link will expire in 30 minutes.</p>
      </div>
    `;

    await sendMail({ to: user.email, subject, text, html });

    await logActivity({
      user,
      action: 'password_reset_requested',
      module: 'auth',
      recordId: user._id,
      metadata: { role: user.role },
    });

    return res.status(200).json({
      message: 'If an admin account matches, a reset link has been sent.',
    });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/admin/reset-password', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    if (!token || !password) {
      return res.status(400).json({ err: 'Reset token and new password are required.' });
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return res.status(400).json({ err: passwordError });
    }

    const user = await User.findOne({
      resetPasswordTokenHash: hashResetToken(token),
      resetPasswordExpiresAt: { $gt: new Date() },
      role: 'admin',
    });

    if (!user) {
      return res.status(400).json({ err: 'Reset link is invalid or expired.' });
    }

    user.hashedPassword = bcrypt.hashSync(password, saltRounds);
    user.passwordChangedAt = new Date();
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastFailedLoginAt = undefined;
    user.resetPasswordTokenHash = undefined;
    user.resetPasswordExpiresAt = undefined;
    await user.save();

    clearAuthCookies(res);

    await logActivity({
      user,
      action: 'password_reset_completed',
      module: 'auth',
      recordId: user._id,
      metadata: { role: user.role },
    });

    return res.status(200).json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  return res.status(200).json({ message: 'Logged out.' });
});

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
