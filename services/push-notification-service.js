const webpush = require('web-push');
const User = require('../models/user');

const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const vapidPrivateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const vapidSubject = String(process.env.VAPID_SUBJECT || 'mailto:admin@lte-bh.com').trim();

const isPushConfigured = Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);

if (isPushConfigured) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

const getPublicPushConfig = () => ({
  configured: isPushConfigured,
  publicKey: vapidPublicKey || '',
});

const buildPushLabel = (req) => {
  const userAgent = String(req.headers['user-agent'] || '').trim();
  if (!userAgent) return 'Browser device';
  if (/iphone/i.test(userAgent)) return 'iPhone browser';
  if (/android/i.test(userAgent)) return 'Android browser';
  if (/ipad/i.test(userAgent)) return 'iPad browser';
  if (/windows/i.test(userAgent)) return 'Windows browser';
  if (/macintosh|mac os/i.test(userAgent)) return 'Mac browser';
  return 'Browser device';
};

const normalizeSubscription = (subscription = {}, req) => {
  const endpoint = String(subscription.endpoint || '').trim();
  const p256dh = String(subscription.keys?.p256dh || '').trim();
  const auth = String(subscription.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  return {
    endpoint,
    expirationTime:
      subscription.expirationTime === null || subscription.expirationTime === undefined
        ? undefined
        : Number(subscription.expirationTime),
    keys: { p256dh, auth },
    label: buildPushLabel(req),
    lastUsedAt: new Date(),
  };
};

const upsertPushSubscription = async ({ user, subscription, req }) => {
  const normalized = normalizeSubscription(subscription, req);
  if (!normalized) {
    const error = new Error('Push subscription is invalid.');
    error.status = 400;
    throw error;
  }

  user.pushSubscriptions = Array.isArray(user.pushSubscriptions) ? user.pushSubscriptions : [];
  const existing = user.pushSubscriptions.find((entry) => entry.endpoint === normalized.endpoint);
  if (existing) {
    existing.expirationTime = normalized.expirationTime;
    existing.keys = normalized.keys;
    existing.label = normalized.label;
    existing.lastUsedAt = new Date();
  } else {
    user.pushSubscriptions.push({
      ...normalized,
      createdAt: new Date(),
    });
  }
  await user.save();
  return user.pushSubscriptions;
};

const removePushSubscription = async ({ user, endpoint }) => {
  const target = String(endpoint || '').trim();
  if (!target) return 0;
  const before = Array.isArray(user.pushSubscriptions) ? user.pushSubscriptions.length : 0;
  user.pushSubscriptions = (user.pushSubscriptions || []).filter((entry) => entry.endpoint !== target);
  if (user.pushSubscriptions.length !== before) {
    await user.save();
  }
  return before - user.pushSubscriptions.length;
};

const listPushSubscriptions = (user) =>
  (user.pushSubscriptions || []).map((entry) => ({
    endpoint: entry.endpoint,
    label: entry.label || 'Browser device',
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastUsedAt,
  }));

const buildPayload = ({ title, body, url = '/admin/dashboard', tag = 'lte-admin-alert', data = {} }) =>
  JSON.stringify({
    title: String(title || 'LTE Admin Alert'),
    body: String(body || ''),
    url: String(url || '/admin/dashboard'),
    tag: String(tag || 'lte-admin-alert'),
    data,
  });

const pruneExpiredSubscription = async ({ userId, endpoint }) => {
  if (!userId || !endpoint) return;
  await User.updateOne(
    { _id: userId },
    { $pull: { pushSubscriptions: { endpoint } } }
  ).catch(() => {});
};

const sendPushToUsers = async ({ users = [], payload }) => {
  if (!isPushConfigured || !users.length) {
    return { sent: 0, skipped: users.length, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  await Promise.all(
    users.flatMap((user) =>
      (user.pushSubscriptions || []).map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              expirationTime: subscription.expirationTime,
              keys: subscription.keys,
            },
            payload
          );
          sent += 1;
        } catch (error) {
          failed += 1;
          if (error.statusCode === 404 || error.statusCode === 410) {
            await pruneExpiredSubscription({ userId: user._id, endpoint: subscription.endpoint });
          }
        }
      })
    )
  );

  return { sent, failed, skipped: 0 };
};

const sendPushToAdmins = async ({ title, body, url, tag, data }) => {
  const admins = await User.find({
    role: 'admin',
    isActive: true,
    'pushSubscriptions.0': { $exists: true },
  }).select('pushSubscriptions');

  if (!admins.length) {
    return { sent: 0, skipped: 0, failed: 0 };
  }

  return sendPushToUsers({
    users: admins,
    payload: buildPayload({ title, body, url, tag, data }),
  });
};

module.exports = {
  getPublicPushConfig,
  isPushConfigured,
  listPushSubscriptions,
  removePushSubscription,
  sendPushToAdmins,
  upsertPushSubscription,
};
