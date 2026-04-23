const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/user');
const { sendMail, isConfigured: isMailerConfigured } = require('../utils/mailer');
const { buildIdentifierQuery } = require('../utils/identifier');
const { logActivity } = require('../services/activity-log-service');
const {
  getPublicPushConfig,
  isPushConfigured,
  listPushSubscriptions,
  removePushSubscription,
  upsertPushSubscription,
  sendPushToUser,
} = require('../services/push-notification-service');
const { buildOtpAuthUrl, generateBackupCodes, generateSecret, verifyTotp } = require('../utils/totp');
const {
  MFA_CHALLENGE_PURPOSE,
  MFA_CHALLENGE_TTL_MS,
  TOKEN_TTLS,
  clearAuthCookies,
  clearFailedLoginState,
  decryptSecret,
  encryptSecret,
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
  const query = buildIdentifierQuery(identifier);
  if (!query) return null;
  return User.findOne(query);
};

const normalizeUsername = (email, username) => {
  if (username && username.trim()) return username.trim();
  return email.trim().toLowerCase();
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const normalizePhone = (phone) => String(phone || '').trim();
const hashResetToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const hashRecoveryCode = (code) => crypto.createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex');
const hashTrustedDeviceToken = (token) => crypto.createHash('sha256').update(String(token || '').trim()).digest('hex');
const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const cleanTrustedDevices = (user) => {
  const now = new Date();
  user.trustedDevices = (user.trustedDevices || []).filter((entry) => entry?.expiresAt && new Date(entry.expiresAt) > now);
};
const buildTrustedDeviceLabel = (req) => {
  const userAgent = String(req.headers['user-agent'] || '').trim();
  if (!userAgent) return 'Trusted device';
  if (/iphone/i.test(userAgent)) return 'iPhone browser';
  if (/android/i.test(userAgent)) return 'Android browser';
  if (/ipad/i.test(userAgent)) return 'iPad browser';
  if (/windows/i.test(userAgent)) return 'Windows browser';
  if (/macintosh|mac os/i.test(userAgent)) return 'Mac browser';
  return 'Trusted browser';
};
const registerTrustedDevice = (user, req) => {
  cleanTrustedDevices(user);
  const deviceToken = crypto.randomBytes(32).toString('hex');
  user.trustedDevices.push({
    tokenHash: hashTrustedDeviceToken(deviceToken),
    label: buildTrustedDeviceLabel(req),
    createdAt: new Date(),
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS),
  });
  return deviceToken;
};
const useTrustedDevice = (user, deviceToken) => {
  if (!deviceToken) return false;
  cleanTrustedDevices(user);
  const tokenHash = hashTrustedDeviceToken(deviceToken);
  const entry = (user.trustedDevices || []).find((item) => item.tokenHash === tokenHash);
  if (!entry) return false;
  entry.lastUsedAt = new Date();
  return true;
};
const signSessionToken = (user) =>
  jwt.sign({ payload: buildPayload(user) }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTLS[user.role] || TOKEN_TTLS.user });
const signMfaChallengeToken = (user) =>
  jwt.sign(
    {
      payload: {
        _id: user._id,
        role: user.role,
        purpose: MFA_CHALLENGE_PURPOSE,
      },
    },
    process.env.JWT_SECRET,
    { expiresIn: Math.floor(MFA_CHALLENGE_TTL_MS / 1000) }
  );
const buildPublicUser = (user) => ({
  _id: user._id,
  username: user.username,
  email: user.email,
  phone: user.phone,
  name: user.name,
  department: user.department,
  marketingOptIn: user.marketingOptIn,
  isActive: user.isActive,
  role: user.role,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  mfaEnabled: Boolean(user.mfaEnabled),
});

const getStaffPushStatusPayload = (user) => ({
  pushConfigured: isPushConfigured,
  pushSubscriptions: listPushSubscriptions(user),
  pushSessionTtl: TOKEN_TTLS.sales_staff,
});

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

    res.status(201).json({ token, user: buildPublicUser(user) });
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

    user.lastLoginAt = new Date();
    const trustedDeviceToken = String(req.body.trustedDeviceToken || '').trim();
    let trustedDeviceAccepted = false;
    if (user.role === 'admin' && user.mfaEnabled && user.mfaSecretEncrypted) {
      trustedDeviceAccepted = useTrustedDevice(user, trustedDeviceToken);
    }
    await user.save();

    if (user.role === 'admin' && user.mfaEnabled && user.mfaSecretEncrypted && !trustedDeviceAccepted) {
      const challengeToken = signMfaChallengeToken(user);
      await logActivity({
        user,
        action: 'mfa_challenge_issued',
        module: 'auth',
        recordId: user._id,
        metadata: { role: user.role },
      });
      return res.status(200).json({
        mfaRequired: true,
        challengeToken,
      });
    }

    const token = signSessionToken(user);
    setAuthCookie(res, user, token);

    await logActivity({
      user,
      action: 'login_success',
      module: 'auth',
      recordId: user._id,
      metadata: { role: user.role },
    });

    res.status(200).json({ token, user: buildPublicUser(user), trustedDeviceAccepted });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};

router.post('/sign-up', signUpHandler);
router.post('/register', signUpHandler);
router.post('/sign-in', signInHandler);
router.post('/login', signInHandler);

router.post('/admin/mfa/verify-login', async (req, res) => {
  try {
    const challengeToken = String(req.body.challengeToken || '').trim();
    const code = String(req.body.code || '').trim();
    const trustDevice = req.body.trustDevice === true;
    if (!challengeToken || !code) {
      return res.status(400).json({ err: 'Challenge token and MFA code are required.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(challengeToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ err: 'MFA challenge is invalid or expired.' });
    }

    if (decoded?.payload?.purpose !== MFA_CHALLENGE_PURPOSE || decoded?.payload?.role !== 'admin') {
      return res.status(400).json({ err: 'Invalid MFA challenge.' });
    }

    const user = await User.findById(decoded.payload._id);
    if (!user || user.role !== 'admin' || !user.mfaEnabled || !user.mfaSecretEncrypted) {
      return res.status(400).json({ err: 'Admin MFA is not available for this account.' });
    }

    const normalizedCode = code.toUpperCase();
    let valid = verifyTotp(decryptSecret(user.mfaSecretEncrypted), normalizedCode);

    if (!valid) {
      const recoveryIndex = (user.mfaRecoveryCodeHashes || []).findIndex((entry) => entry === hashRecoveryCode(normalizedCode));
      if (recoveryIndex !== -1) {
        user.mfaRecoveryCodeHashes.splice(recoveryIndex, 1);
        valid = true;
      }
    }

    if (!valid) {
      await logActivity({
        user,
        action: 'mfa_challenge_failed',
        module: 'auth',
        recordId: user._id,
      });
      await user.save();
      return res.status(401).json({ err: 'Invalid MFA code.' });
    }

    await user.save();
    const token = signSessionToken(user);
    setAuthCookie(res, user, token);
    const trustedDeviceToken = trustDevice ? registerTrustedDevice(user, req) : null;
    if (trustedDeviceToken) await user.save();

    await logActivity({
      user,
      action: 'mfa_challenge_passed',
      module: 'auth',
      recordId: user._id,
      metadata: trustDevice ? { trustedDevice: true } : undefined,
    });

    return res.status(200).json({ token, user: buildPublicUser(user), trustedDeviceToken });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

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

router.get('/admin/mfa/status', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });
    return res.json({
      mfaEnabled: Boolean(user.mfaEnabled && user.mfaSecretEncrypted),
      backupCodesRemaining: (user.mfaRecoveryCodeHashes || []).length,
      trustedDevices: (user.trustedDevices || []).map((entry) => ({
        label: entry.label || 'Trusted device',
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
        expiresAt: entry.expiresAt,
      })),
      passwordChangedAt: user.passwordChangedAt || null,
      lastLoginAt: user.lastLoginAt || null,
      smtpConfigured: Boolean(isMailerConfigured),
      pushConfigured: isPushConfigured,
      pushSubscriptions: listPushSubscriptions(user),
      adminSessionTtl: TOKEN_TTLS.admin,
      recommendedActions: [
        !user.mfaEnabled ? 'Enable MFA for this admin account.' : null,
        !isMailerConfigured ? 'Configure SMTP so password reset works securely.' : null,
        !isPushConfigured ? 'Configure VAPID keys so browser push notifications can be enabled.' : null,
      ].filter(Boolean),
    });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.get('/admin/push/public-key', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('role');
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });
    const config = getPublicPushConfig();
    return res.status(config.configured ? 200 : 503).json(config);
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/admin/push/subscribe', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });
    if (!isPushConfigured) return res.status(503).json({ err: 'Push notifications are not configured on the server.' });

    await upsertPushSubscription({ user, subscription: req.body.subscription, req });

    await logActivity({
      user,
      action: 'push_subscription_registered',
      module: 'auth',
      recordId: user._id,
    });

    return res.status(200).json({
      message: 'Push notifications enabled.',
      subscriptions: listPushSubscriptions(user),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ err: err.message });
  }
});

router.post('/admin/push/unsubscribe', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });

    const removed = await removePushSubscription({ user, endpoint: req.body.endpoint });

    await logActivity({
      user,
      action: 'push_subscription_removed',
      module: 'auth',
      recordId: user._id,
      metadata: { removed },
    });

    return res.status(200).json({
      message: removed ? 'Push subscription removed.' : 'No matching push subscription was found.',
      removed,
      subscriptions: listPushSubscriptions(user),
    });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/admin/push/test', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });
    if (!isPushConfigured) return res.status(503).json({ err: 'Push notifications are not configured on the server.' });
    if (!(user.pushSubscriptions || []).length) return res.status(400).json({ err: 'No push-enabled device is registered for this admin.' });

    const result = await sendPushToUser({
      user,
      title: 'LTE test notification',
      body: 'Push delivery is working on this admin device.',
      url: '/admin/account',
      tag: `push-test-${Date.now()}`,
      data: { source: 'admin-push-test' },
    });

    return res.status(200).json({
      message: result.sent ? 'Test notification sent.' : 'No push notification was delivered.',
      result,
    });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.get('/staff/push/status', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'sales_staff') return res.status(404).json({ err: 'Staff user not found.' });
    return res.status(200).json(getStaffPushStatusPayload(user));
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.get('/staff/push/public-key', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('role');
    if (!user || user.role !== 'sales_staff') return res.status(404).json({ err: 'Staff user not found.' });
    const config = getPublicPushConfig();
    return res.status(config.configured ? 200 : 503).json(config);
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/staff/push/subscribe', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'sales_staff') return res.status(404).json({ err: 'Staff user not found.' });
    if (!isPushConfigured) return res.status(503).json({ err: 'Push notifications are not configured on the server.' });

    await upsertPushSubscription({ user, subscription: req.body.subscription, req });

    await logActivity({
      user,
      action: 'push_subscription_registered',
      module: 'auth',
      recordId: user._id,
      metadata: { role: user.role },
    });

    return res.status(200).json({
      message: 'Push notifications enabled.',
      subscriptions: listPushSubscriptions(user),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ err: err.message });
  }
});

router.post('/staff/push/unsubscribe', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'sales_staff') return res.status(404).json({ err: 'Staff user not found.' });

    const removed = await removePushSubscription({ user, endpoint: req.body.endpoint });

    await logActivity({
      user,
      action: 'push_subscription_removed',
      module: 'auth',
      recordId: user._id,
      metadata: { removed, role: user.role },
    });

    return res.status(200).json({
      message: removed ? 'Push subscription removed.' : 'No matching push subscription was found.',
      removed,
      subscriptions: listPushSubscriptions(user),
    });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/staff/push/test', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'sales_staff') return res.status(404).json({ err: 'Staff user not found.' });
    if (!isPushConfigured) return res.status(503).json({ err: 'Push notifications are not configured on the server.' });
    if (!(user.pushSubscriptions || []).length) return res.status(400).json({ err: 'No push-enabled device is registered for this staff account.' });

    const result = await sendPushToUser({
      user,
      title: 'LTE staff test notification',
      body: 'Push delivery is working on this staff device.',
      url: '/staff/account',
      tag: `staff-push-test-${Date.now()}`,
      data: { source: 'staff-push-test' },
    });

    return res.status(200).json({
      message: result.sent ? 'Test notification sent.' : 'No push notification was delivered.',
      result,
    });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/admin/mfa/setup/start', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });
    const secret = generateSecret();
    user.mfaPendingSecretEncrypted = encryptSecret(secret);
    await user.save();
    return res.status(200).json({
      manualKey: secret,
      otpAuthUrl: buildOtpAuthUrl({
        secret,
        accountName: user.email || user.username,
        issuer: 'LTE Admin',
      }),
    });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/admin/mfa/setup/confirm', verifyToken, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim();
    const trustDevice = req.body.trustDevice === true;
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });
    if (!user.mfaPendingSecretEncrypted) return res.status(400).json({ err: 'Start MFA setup first.' });
    const secret = decryptSecret(user.mfaPendingSecretEncrypted);
    if (!verifyTotp(secret, code)) {
      return res.status(400).json({ err: 'The MFA code is not valid.' });
    }

    const backupCodes = generateBackupCodes();
    user.mfaSecretEncrypted = user.mfaPendingSecretEncrypted;
    user.mfaPendingSecretEncrypted = undefined;
    user.mfaEnabled = true;
    user.mfaRecoveryCodeHashes = backupCodes.map(hashRecoveryCode);
    const trustedDeviceToken = trustDevice ? registerTrustedDevice(user, req) : null;
    await user.save();

    await logActivity({
      user,
      action: 'mfa_enabled',
      module: 'auth',
      recordId: user._id,
    });

    return res.status(200).json({ backupCodes, trustedDeviceToken });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/admin/mfa/disable', verifyToken, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });
    if (!user.mfaEnabled || !user.mfaSecretEncrypted) return res.status(400).json({ err: 'MFA is not enabled.' });

    let valid = verifyTotp(decryptSecret(user.mfaSecretEncrypted), code);
    if (!valid) {
      const recoveryIndex = (user.mfaRecoveryCodeHashes || []).findIndex((entry) => entry === hashRecoveryCode(code));
      if (recoveryIndex !== -1) {
        user.mfaRecoveryCodeHashes.splice(recoveryIndex, 1);
        valid = true;
      }
    }

    if (!valid) return res.status(400).json({ err: 'Invalid MFA code.' });

    user.mfaEnabled = false;
    user.mfaSecretEncrypted = undefined;
    user.mfaPendingSecretEncrypted = undefined;
    user.mfaRecoveryCodeHashes = [];
    await user.save();

    await logActivity({
      user,
      action: 'mfa_disabled',
      module: 'auth',
      recordId: user._id,
    });

    return res.status(200).json({ message: 'MFA disabled.' });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.post('/admin/mfa/recovery-codes/refresh', verifyToken, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });
    if (!user.mfaEnabled || !user.mfaSecretEncrypted) return res.status(400).json({ err: 'MFA is not enabled.' });
    if (!verifyTotp(decryptSecret(user.mfaSecretEncrypted), code)) {
      return res.status(400).json({ err: 'Invalid MFA code.' });
    }
    const backupCodes = generateBackupCodes();
    user.mfaRecoveryCodeHashes = backupCodes.map(hashRecoveryCode);
    await user.save();
    await logActivity({
      user,
      action: 'mfa_backup_codes_refreshed',
      module: 'auth',
      recordId: user._id,
    });
    return res.status(200).json({ backupCodes });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

router.delete('/admin/mfa/trusted-devices', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || user.role !== 'admin') return res.status(404).json({ err: 'Admin user not found.' });
    user.trustedDevices = [];
    await user.save();
    await logActivity({
      user,
      action: 'trusted_devices_revoked',
      module: 'auth',
      recordId: user._id,
    });
    return res.status(200).json({ message: 'Trusted devices removed.' });
  } catch (err) {
    return res.status(500).json({ err: err.message });
  }
});

// Get current logged-in user
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-hashedPassword');
    if (!user) return res.status(404).json({ err: 'User not found' });
    res.json({ user: buildPublicUser(user) });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

module.exports = router;
