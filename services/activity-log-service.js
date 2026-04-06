const ActivityLog = require('../models/activityLog');

const logActivity = async ({
  user,
  action,
  module,
  recordId,
  metadata = {},
  actorRole,
}) => {
  if (!user?._id || !action || !module) return null;

  return ActivityLog.create({
    user: user._id,
    action,
    module,
    recordId,
    metadata,
    actorRole: actorRole || user.role,
  });
};

module.exports = { logActivity };
