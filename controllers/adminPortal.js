const express = require('express');
const mongoose = require('mongoose');

const User = require('../models/user');
const AttendanceLog = require('../models/attendanceLog');
const DailyReport = require('../models/dailyReport');
const SalesOrder = require('../models/salesOrder');
const ActivityLog = require('../models/activityLog');
const Client = require('../models/client');
const ClientVisit = require('../models/clientVisit');
const Notification = require('../models/notification');

const requireAuthUser = require('../middleware/require-auth-user');
const requireRoles = require('../middleware/require-roles');
const { ok, fail } = require('../utils/respond');
const { logActivity } = require('../services/activity-log-service');
const { toCsv } = require('../utils/csv');

const router = express.Router();

const isValidObjectId = (value) => mongoose.isValidObjectId(value);
const PORTAL_TIME_ZONE = process.env.PORTAL_TIME_ZONE || 'Asia/Baghdad';
const todayKey = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PORTAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const sendUserNotification = async ({ user, title, message, type = 'info', relatedModule, relatedRecord }) => {
  if (!user) return null;
  return Notification.create({
    user,
    title,
    message,
    type,
    relatedModule,
    relatedRecord,
  });
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PORTAL_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const applyAdminFilters = (req, base = {}) => {
  const filters = { ...base };
  if (req.query.user && isValidObjectId(req.query.user)) filters.user = req.query.user;
  if (req.query.status) filters.status = req.query.status;
  if (req.query.date) {
    if (req.path.includes('attendance') || req.path.includes('reports')) filters.date = req.query.date;
  }
  return filters;
};

const exportCsv = (res, filename, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(toCsv(rows));
};

router.use(requireAuthUser, requireRoles('admin'));

router.get('/dashboard', async (req, res, next) => {
  try {
    const today = todayKey();
    const [staffCount, checkedInToday, pendingReports, pendingOrders, visitsByEmployee, recentActivity] =
      await Promise.all([
        User.countDocuments({ role: 'sales_staff', isActive: true }),
        AttendanceLog.countDocuments({ date: today, checkInTime: { $exists: true, $ne: null } }),
        DailyReport.countDocuments({ date: today }),
        SalesOrder.countDocuments({ status: { $in: ['submitted', 'reviewed'] } }),
        ClientVisit.aggregate([
          { $match: { visitDate: today } },
          { $group: { _id: '$user', visits: { $sum: 1 } } },
        ]),
        ActivityLog.find({ createdAt: { $gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) } })
          .sort({ createdAt: -1 })
          .limit(20)
          .populate('user', 'name username'),
      ]);

    return ok(res, {
      today,
      metrics: {
        staffCount,
        checkedInToday,
        notCheckedIn: Math.max(0, staffCount - checkedInToday),
        pendingReports,
        pendingOrders,
      },
      visitsByEmployee,
      recentActivity,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/staff', async (req, res, next) => {
  try {
    const staff = await User.find({ role: 'sales_staff' }).select('-hashedPassword').sort({ name: 1, username: 1 });
    return ok(res, { staff });
  } catch (error) {
    return next(error);
  }
});

router.get('/staff/:id/summary', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid staff id.', 400);
    const staffUser = await User.findOne({ _id: req.params.id, role: 'sales_staff' }).select('-hashedPassword');
    if (!staffUser) return fail(res, 'Staff user not found.', 404);

    const userFilter = { user: staffUser._id };
    const today = todayKey();

    const [
      attendanceCount,
      lastAttendance,
      reportsCount,
      lastReport,
      ordersCount,
      pendingOrders,
      lastOrder,
      visitsCount,
      lastVisit,
      clientsCount,
      unreadNotifications,
      recentActivity,
    ] = await Promise.all([
      AttendanceLog.countDocuments(userFilter),
      AttendanceLog.findOne(userFilter).sort({ date: -1, createdAt: -1 }),
      DailyReport.countDocuments(userFilter),
      DailyReport.findOne(userFilter).sort({ date: -1, createdAt: -1 }),
      SalesOrder.countDocuments(userFilter),
      SalesOrder.countDocuments({ ...userFilter, status: { $in: ['submitted', 'reviewed', 'emailed', 'confirmed'] } }),
      SalesOrder.findOne(userFilter).sort({ createdAt: -1 }),
      ClientVisit.countDocuments(userFilter),
      ClientVisit.findOne(userFilter).sort({ visitDate: -1, createdAt: -1 }),
      Client.countDocuments({ assignedTo: staffUser._id }),
      Notification.countDocuments({ user: staffUser._id, read: false }),
      ActivityLog.find({ user: staffUser._id }).sort({ createdAt: -1 }).limit(12),
    ]);

    return ok(res, {
      staff: staffUser,
      today,
      metrics: {
        attendanceCount,
        reportsCount,
        ordersCount,
        pendingOrders,
        visitsCount,
        clientsCount,
        unreadNotifications,
      },
      latest: {
        attendance: lastAttendance,
        report: lastReport,
        order: lastOrder,
        visit: lastVisit,
      },
      recentActivity,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/staff/:id/report', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid staff id.', 400);
    const staffUser = await User.findOne({ _id: req.params.id, role: 'sales_staff' }).select('-hashedPassword');
    if (!staffUser) return fail(res, 'Staff user not found.', 404);

    const userFilter = { user: staffUser._id };

    const [
      attendanceCount,
      lastAttendance,
      reportsCount,
      lastReport,
      ordersCount,
      lastOrder,
      visitsCount,
      lastVisit,
      clientsCount,
    ] = await Promise.all([
      AttendanceLog.countDocuments(userFilter),
      AttendanceLog.findOne(userFilter).sort({ date: -1, createdAt: -1 }),
      DailyReport.countDocuments(userFilter),
      DailyReport.findOne(userFilter).sort({ date: -1, createdAt: -1 }),
      SalesOrder.countDocuments(userFilter),
      SalesOrder.findOne(userFilter).sort({ createdAt: -1 }),
      ClientVisit.countDocuments(userFilter),
      ClientVisit.findOne(userFilter).sort({ visitDate: -1, createdAt: -1 }),
      Client.countDocuments({ assignedTo: staffUser._id }),
    ]);

    return exportCsv(res, `staff-report-${staffUser.username || staffUser._id}.csv`, [
      { field: 'Name', value: staffUser.name || '-' },
      { field: 'Username', value: staffUser.username || '-' },
      { field: 'Email', value: staffUser.email || '-' },
      { field: 'Phone', value: staffUser.phone || '-' },
      { field: 'Department', value: staffUser.department || '-' },
      { field: 'Active', value: staffUser.isActive ? 'Yes' : 'No' },
      { field: 'Attendance Entries', value: attendanceCount },
      { field: 'Last Attendance Date', value: lastAttendance?.date || '-' },
      { field: 'Last Check In', value: formatDateTime(lastAttendance?.checkInTime) },
      { field: 'Last Check Out', value: formatDateTime(lastAttendance?.checkOutTime) },
      { field: 'Reports', value: reportsCount },
      { field: 'Latest Report', value: lastReport?.summary || '-' },
      { field: 'Latest Report Date', value: lastReport?.date || '-' },
      { field: 'Orders', value: ordersCount },
      { field: 'Latest Order', value: lastOrder?.customerName || lastOrder?.companyName || '-' },
      { field: 'Latest Order Submitted', value: formatDateTime(lastOrder?.createdAt) },
      { field: 'Visits', value: visitsCount },
      { field: 'Latest Visit', value: lastVisit?.purpose || lastVisit?.clientLabel || '-' },
      { field: 'Latest Visit Date', value: lastVisit?.visitDate || '-' },
      { field: 'Clients', value: clientsCount },
    ]);
  } catch (error) {
    return next(error);
  }
});

router.post('/staff', async (req, res, next) => {
  try {
    const bcrypt = require('bcrypt');
    const { username, email, phone, password, name, department } = req.body;
    if (!username || !email || !phone || !password) {
      return fail(res, 'Username, email, phone, and password are required.', 400);
    }

    const existing = await User.findOne({
      $or: [{ username: username.trim() }, { email: email.trim().toLowerCase() }, { phone: phone.trim() }],
    });
    if (existing) return fail(res, 'A user with these credentials already exists.', 409);

    const staffUser = await User.create({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      hashedPassword: bcrypt.hashSync(password, 12),
      name,
      department,
      role: 'sales_staff',
      isActive: true,
    });

    await logActivity({
      user: req.user,
      action: 'staff_user_created',
      module: 'staff_user',
      recordId: staffUser._id,
      metadata: { username: staffUser.username },
    });

    return ok(res, { staff: staffUser }, 'Staff user created.', 201);
  } catch (error) {
    return next(error);
  }
});

router.patch('/staff/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid staff id.', 400);
    const staffUser = await User.findOne({ _id: req.params.id, role: 'sales_staff' });
    if (!staffUser) return fail(res, 'Staff user not found.', 404);

    ['name', 'email', 'phone', 'department', 'isActive'].forEach((field) => {
      if (req.body[field] !== undefined) {
        staffUser[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
      }
    });
    await staffUser.save();

    await logActivity({
      user: req.user,
      action: 'staff_user_updated',
      module: 'staff_user',
      recordId: staffUser._id,
      metadata: { isActive: staffUser.isActive },
    });

    return ok(res, { staff: staffUser }, 'Staff user updated.');
  } catch (error) {
    return next(error);
  }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const records = await AttendanceLog.find(applyAdminFilters(req))
      .sort({ date: -1, createdAt: -1 })
      .populate('user', 'name username department');
    return ok(res, { records });
  } catch (error) {
    return next(error);
  }
});

router.get('/reports', async (req, res, next) => {
  try {
    const reports = await DailyReport.find(applyAdminFilters(req)).sort({ date: -1, createdAt: -1 }).populate('user relatedSchedule');
    return ok(res, { reports });
  } catch (error) {
    return next(error);
  }
});

router.get('/orders', async (req, res, next) => {
  try {
    const orders = await SalesOrder.find(applyAdminFilters(req)).sort({ createdAt: -1 }).populate('user client', 'name username');
    return ok(res, { orders });
  } catch (error) {
    return next(error);
  }
});

router.patch('/orders/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid order id.', 400);
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return fail(res, 'Order not found.', 404);
    if (req.body.status) order.status = req.body.status;
    order.statusHistory.push({
      status: order.status,
      note: req.body.note || '',
      changedBy: req.user._id,
    });
    await order.save();

    await sendUserNotification({
      user: order.user,
      title: 'Order updated',
      message: `Your order for ${order.companyName || order.customerName} is now ${order.status}.`,
      relatedModule: 'sales_order',
      relatedRecord: order._id,
    });

    await logActivity({ user: req.user, action: 'sales_order_updated', module: 'sales_order', recordId: order._id });
    return ok(res, { order }, 'Order updated.');
  } catch (error) {
    return next(error);
  }
});

router.get('/clients', async (req, res, next) => {
  try {
    const clients = await Client.find({}).sort({ updatedAt: -1 }).populate('assignedTo createdBy', 'name username');
    return ok(res, { clients });
  } catch (error) {
    return next(error);
  }
});

router.get('/visits', async (req, res, next) => {
  try {
    const visits = await ClientVisit.find(applyAdminFilters(req)).sort({ createdAt: -1 }).populate('user client relatedSchedule', 'name username');
    return ok(res, { visits });
  } catch (error) {
    return next(error);
  }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const notifications = await Notification.find({}).sort({ createdAt: -1 }).limit(100).populate('user', 'name username');
    return ok(res, { notifications });
  } catch (error) {
    return next(error);
  }
});

router.get('/activity-logs', async (req, res, next) => {
  try {
    const filters = {};
    if (req.query.user && isValidObjectId(req.query.user)) filters.user = req.query.user;
    if (req.query.module) filters.module = req.query.module;
    if (req.query.action) filters.action = req.query.action;
    const logs = await ActivityLog.find(filters).sort({ createdAt: -1 }).limit(250).populate('user', 'name username role');
    return ok(res, { logs });
  } catch (error) {
    return next(error);
  }
});

router.get('/exports/:resource', async (req, res, next) => {
  try {
    const exporters = {
      attendance: async () =>
        AttendanceLog.find({}).populate('user', 'name username').lean().then((rows) =>
          rows.map((row) => ({
            employee: row.user?.name || row.user?.username || '-',
            date: row.date,
            checkInTime: row.checkInTime?.toISOString?.() || '',
            checkOutTime: row.checkOutTime?.toISOString?.() || '',
            totalWorkedMinutes: row.totalWorkedMinutes || 0,
          }))
        ),
      reports: async () =>
        DailyReport.find({}).populate('user', 'name username').lean().then((rows) =>
          rows.map((row) => ({
            employee: row.user?.name || row.user?.username || '-',
            date: row.date,
            summary: row.summary,
            followUpNeeded: row.followUpNeeded,
          }))
        ),
      orders: async () =>
        SalesOrder.find({}).populate('user', 'name username').lean().then((rows) =>
          rows.map((row) => ({
            employee: row.user?.name || row.user?.username || '-',
            customerName: row.customerName,
            companyName: row.companyName,
            status: row.status,
            submittedAt: row.submittedAt?.toISOString?.() || '',
            emailSent: row.emailSent,
          }))
        ),
      visits: async () =>
        ClientVisit.find({}).populate('user', 'name username').lean().then((rows) =>
          rows.map((row) => ({
            employee: row.user?.name || row.user?.username || '-',
            clientName: row.clientName,
            visitDate: row.visitDate,
            location: row.location,
            purpose: row.purpose,
            outcome: row.outcome,
          }))
        ),
    };

    const handler = exporters[req.params.resource];
    if (!handler) return fail(res, 'Unsupported export resource.', 404);
    const rows = await handler();
    return exportCsv(res, `${req.params.resource}.csv`, rows);
  } catch (error) {
    return next(error);
  }
});

router.use((error, req, res, next) => {
  console.error('[admin-portal]', error);
  return fail(res, error.message || 'Admin portal request failed.', 500);
});

module.exports = router;
