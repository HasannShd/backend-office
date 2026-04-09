const express = require('express');
const mongoose = require('mongoose');

const User = require('../models/user');
const AttendanceLog = require('../models/attendanceLog');
const Schedule = require('../models/schedule');
const DailyReport = require('../models/dailyReport');
const SalesOrder = require('../models/salesOrder');
const ExpenseRequest = require('../models/expenseRequest');
const ActivityLog = require('../models/activityLog');
const Client = require('../models/client');
const ClientVisit = require('../models/clientVisit');
const FollowUp = require('../models/followUp');
const Quotation = require('../models/quotation');
const CollectionLog = require('../models/collectionLog');
const StockRequest = require('../models/stockRequest');
const ProductDemand = require('../models/productDemand');
const IssueReport = require('../models/issueReport');
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
    if ('assignedDate' in base || req.path.includes('schedules')) filters.assignedDate = req.query.date;
    else if (req.path.includes('attendance')) filters.date = req.query.date;
    else if (req.path.includes('reports')) filters.date = req.query.date;
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
    const [staffCount, checkedInToday, pendingReports, pendingExpenses, pendingOrders, dueFollowUps, visitsByEmployee, recentActivity] =
      await Promise.all([
        User.countDocuments({ role: 'sales_staff', isActive: true }),
        AttendanceLog.countDocuments({ date: today, checkInTime: { $exists: true, $ne: null } }),
        DailyReport.countDocuments({ date: today }),
        ExpenseRequest.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
        SalesOrder.countDocuments({ status: { $in: ['submitted', 'reviewed'] } }),
        FollowUp.countDocuments({ status: 'pending', dueDate: { $lte: today } }),
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
        pendingExpenses,
        pendingOrders,
        dueFollowUps,
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
      schedulesCount,
      completedSchedules,
      nextSchedule,
      reportsCount,
      lastReport,
      ordersCount,
      pendingOrders,
      lastOrder,
      expensesCount,
      pendingExpenses,
      lastExpense,
      visitsCount,
      lastVisit,
      followUpsCount,
      pendingFollowUps,
      quotationsCount,
      collectionsCount,
      requestsCount,
      demandsCount,
      issuesCount,
      unreadNotifications,
      recentActivity,
    ] = await Promise.all([
      AttendanceLog.countDocuments(userFilter),
      AttendanceLog.findOne(userFilter).sort({ date: -1, createdAt: -1 }),
      Schedule.countDocuments(userFilter),
      Schedule.countDocuments({ ...userFilter, status: 'completed' }),
      Schedule.findOne({ ...userFilter, assignedDate: { $gte: today } }).sort({ assignedDate: 1, startTime: 1 }),
      DailyReport.countDocuments(userFilter),
      DailyReport.findOne(userFilter).sort({ date: -1, createdAt: -1 }),
      SalesOrder.countDocuments(userFilter),
      SalesOrder.countDocuments({ ...userFilter, status: { $in: ['submitted', 'reviewed', 'emailed', 'confirmed'] } }),
      SalesOrder.findOne(userFilter).sort({ createdAt: -1 }),
      ExpenseRequest.countDocuments(userFilter),
      ExpenseRequest.countDocuments({ ...userFilter, status: { $in: ['submitted', 'under_review'] } }),
      ExpenseRequest.findOne(userFilter).sort({ createdAt: -1 }),
      ClientVisit.countDocuments(userFilter),
      ClientVisit.findOne(userFilter).sort({ visitDate: -1, createdAt: -1 }),
      FollowUp.countDocuments(userFilter),
      FollowUp.countDocuments({ ...userFilter, status: 'pending' }),
      Quotation.countDocuments(userFilter),
      CollectionLog.countDocuments(userFilter),
      StockRequest.countDocuments(userFilter),
      ProductDemand.countDocuments(userFilter),
      IssueReport.countDocuments({ ...userFilter, status: { $nin: ['resolved', 'closed'] } }),
      Notification.countDocuments({ user: staffUser._id, read: false }),
      ActivityLog.find({ user: staffUser._id }).sort({ createdAt: -1 }).limit(12),
    ]);

    return ok(res, {
      staff: staffUser,
      today,
      metrics: {
        attendanceCount,
        schedulesCount,
        completedSchedules,
        reportsCount,
        ordersCount,
        pendingOrders,
        expensesCount,
        pendingExpenses,
        visitsCount,
        followUpsCount,
        pendingFollowUps,
        quotationsCount,
        collectionsCount,
        requestsCount,
        demandsCount,
        issuesCount,
        unreadNotifications,
      },
      latest: {
        attendance: lastAttendance,
        nextSchedule,
        report: lastReport,
        order: lastOrder,
        expense: lastExpense,
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
      schedulesCount,
      nextSchedule,
      reportsCount,
      lastReport,
      ordersCount,
      lastOrder,
      expensesCount,
      lastExpense,
      visitsCount,
      lastVisit,
      pendingFollowUps,
      quotationsCount,
      collectionsCount,
      requestsCount,
      demandsCount,
      openIssues,
    ] = await Promise.all([
      AttendanceLog.countDocuments(userFilter),
      AttendanceLog.findOne(userFilter).sort({ date: -1, createdAt: -1 }),
      Schedule.countDocuments(userFilter),
      Schedule.findOne(userFilter).sort({ assignedDate: -1, startTime: -1 }),
      DailyReport.countDocuments(userFilter),
      DailyReport.findOne(userFilter).sort({ date: -1, createdAt: -1 }),
      SalesOrder.countDocuments(userFilter),
      SalesOrder.findOne(userFilter).sort({ createdAt: -1 }),
      ExpenseRequest.countDocuments(userFilter),
      ExpenseRequest.findOne(userFilter).sort({ createdAt: -1 }),
      ClientVisit.countDocuments(userFilter),
      ClientVisit.findOne(userFilter).sort({ visitDate: -1, createdAt: -1 }),
      FollowUp.countDocuments({ ...userFilter, status: 'pending' }),
      Quotation.countDocuments(userFilter),
      CollectionLog.countDocuments(userFilter),
      StockRequest.countDocuments(userFilter),
      ProductDemand.countDocuments(userFilter),
      IssueReport.countDocuments({ ...userFilter, status: { $nin: ['resolved', 'closed'] } }),
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
      { field: 'Schedules', value: schedulesCount },
      { field: 'Latest Schedule', value: nextSchedule?.title || '-' },
      { field: 'Latest Schedule Date', value: nextSchedule?.assignedDate || '-' },
      { field: 'Reports', value: reportsCount },
      { field: 'Latest Report', value: lastReport?.summary || '-' },
      { field: 'Latest Report Date', value: lastReport?.date || '-' },
      { field: 'Orders', value: ordersCount },
      { field: 'Latest Order', value: lastOrder?.customerName || lastOrder?.companyName || '-' },
      { field: 'Latest Order Submitted', value: formatDateTime(lastOrder?.createdAt) },
      { field: 'Expenses', value: expensesCount },
      { field: 'Latest Expense', value: lastExpense?.title || '-' },
      { field: 'Latest Expense Submitted', value: formatDateTime(lastExpense?.createdAt) },
      { field: 'Visits', value: visitsCount },
      { field: 'Latest Visit', value: lastVisit?.purpose || lastVisit?.clientLabel || '-' },
      { field: 'Latest Visit Date', value: lastVisit?.visitDate || '-' },
      { field: 'Pending Follow-ups', value: pendingFollowUps },
      { field: 'Quotations', value: quotationsCount },
      { field: 'Collections', value: collectionsCount },
      { field: 'Requests', value: requestsCount },
      { field: 'Demand Logs', value: demandsCount },
      { field: 'Open Issues', value: openIssues },
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

router.get('/schedules', async (req, res, next) => {
  try {
    const schedules = await Schedule.find(applyAdminFilters(req))
      .sort({ assignedDate: 1, startTime: 1 })
      .populate('user client createdBy', 'name username');
    return ok(res, { schedules });
  } catch (error) {
    return next(error);
  }
});

router.post('/schedules', async (req, res, next) => {
  try {
    const { user, title, assignedDate } = req.body;
    if (!isValidObjectId(user) || !title || !assignedDate) {
      return fail(res, 'Assigned user, title, and assigned date are required.', 400);
    }

    const schedule = await Schedule.create({
      ...req.body,
      user,
      client: isValidObjectId(req.body.client) ? req.body.client : undefined,
      createdBy: req.user._id,
    });

    await sendUserNotification({
      user,
      title: 'New schedule assigned',
      message: `${title} has been scheduled for ${assignedDate}.`,
      relatedModule: 'schedule',
      relatedRecord: schedule._id,
    });

    await logActivity({
      user: req.user,
      action: 'schedule_assigned',
      module: 'schedule',
      recordId: schedule._id,
      metadata: { assignedDate, user },
    });

    return ok(res, { schedule }, 'Schedule assigned.', 201);
  } catch (error) {
    return next(error);
  }
});

router.patch('/schedules/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid schedule id.', 400);
    const schedule = await Schedule.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        ...(req.body.client && isValidObjectId(req.body.client) ? { client: req.body.client } : {}),
      },
      { new: true }
    );
    if (!schedule) return fail(res, 'Schedule not found.', 404);
    await logActivity({ user: req.user, action: 'schedule_admin_updated', module: 'schedule', recordId: schedule._id });
    return ok(res, { schedule }, 'Schedule updated.');
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

router.get('/expenses', async (req, res, next) => {
  try {
    const expenses = await ExpenseRequest.find(applyAdminFilters(req)).sort({ createdAt: -1 }).populate('user relatedClient', 'name username');
    return ok(res, { expenses });
  } catch (error) {
    return next(error);
  }
});

router.patch('/expenses/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid expense id.', 400);
    const expense = await ExpenseRequest.findById(req.params.id);
    if (!expense) return fail(res, 'Expense not found.', 404);
    ['status', 'adminNote'].forEach((field) => {
      if (req.body[field] !== undefined) expense[field] = req.body[field];
    });
    expense.reviewedBy = req.user._id;
    expense.reviewedAt = new Date();
    if (expense.status === 'paid') expense.paidAt = new Date();
    await expense.save();

    await sendUserNotification({
      user: expense.user,
      title: 'Expense request updated',
      message: `${expense.title} is now ${expense.status}.`,
      relatedModule: 'expense_request',
      relatedRecord: expense._id,
    });

    await logActivity({ user: req.user, action: 'expense_updated', module: 'expense_request', recordId: expense._id });
    return ok(res, { expense }, 'Expense updated.');
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

router.get('/followups', async (req, res, next) => {
  try {
    const followUps = await FollowUp.find(applyAdminFilters(req)).sort({ dueDate: 1 }).populate('user client', 'name username');
    return ok(res, { followUps });
  } catch (error) {
    return next(error);
  }
});

router.get('/quotations', async (req, res, next) => {
  try {
    const quotations = await Quotation.find(applyAdminFilters(req)).sort({ createdAt: -1 }).populate('user client', 'name username');
    return ok(res, { quotations });
  } catch (error) {
    return next(error);
  }
});

router.get('/collections', async (req, res, next) => {
  try {
    const collections = await CollectionLog.find(applyAdminFilters(req)).sort({ createdAt: -1 }).populate('user client', 'name username');
    return ok(res, { collections });
  } catch (error) {
    return next(error);
  }
});

router.get('/stock-requests', async (req, res, next) => {
  try {
    const requests = await StockRequest.find(applyAdminFilters(req)).sort({ createdAt: -1 }).populate('user', 'name username');
    return ok(res, { requests });
  } catch (error) {
    return next(error);
  }
});

router.patch('/stock-requests/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid request id.', 400);
    const request = await StockRequest.findById(req.params.id);
    if (!request) return fail(res, 'Request not found.', 404);
    ['status', 'adminNote'].forEach((field) => {
      if (req.body[field] !== undefined) request[field] = req.body[field];
    });
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save();

    await sendUserNotification({
      user: request.user,
      title: 'Stock request updated',
      message: `${request.item} request is now ${request.status}.`,
      relatedModule: 'stock_request',
      relatedRecord: request._id,
    });

    await logActivity({ user: req.user, action: 'stock_request_updated', module: 'stock_request', recordId: request._id });
    return ok(res, { request }, 'Request updated.');
  } catch (error) {
    return next(error);
  }
});

router.get('/product-demands', async (req, res, next) => {
  try {
    const demands = await ProductDemand.find(applyAdminFilters(req)).sort({ createdAt: -1 }).populate('user client', 'name username');
    return ok(res, { demands });
  } catch (error) {
    return next(error);
  }
});

router.get('/issues', async (req, res, next) => {
  try {
    const issues = await IssueReport.find(applyAdminFilters(req)).sort({ createdAt: -1 }).populate('user client order', 'name username');
    return ok(res, { issues });
  } catch (error) {
    return next(error);
  }
});

router.patch('/issues/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid issue id.', 400);
    const issue = await IssueReport.findById(req.params.id);
    if (!issue) return fail(res, 'Issue not found.', 404);
    ['status', 'adminNote'].forEach((field) => {
      if (req.body[field] !== undefined) issue[field] = req.body[field];
    });
    issue.reviewedBy = req.user._id;
    issue.reviewedAt = new Date();
    await issue.save();

    await sendUserNotification({
      user: issue.user,
      title: 'Issue updated',
      message: `Issue status is now ${issue.status}.`,
      relatedModule: 'issue_report',
      relatedRecord: issue._id,
    });

    await logActivity({ user: req.user, action: 'issue_updated', module: 'issue_report', recordId: issue._id });
    return ok(res, { issue }, 'Issue updated.');
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
      expenses: async () =>
        ExpenseRequest.find({}).populate('user', 'name username').lean().then((rows) =>
          rows.map((row) => ({
            employee: row.user?.name || row.user?.username || '-',
            title: row.title,
            category: row.category,
            amount: row.amount,
            expenseDate: row.expenseDate,
            status: row.status,
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
      followups: async () =>
        FollowUp.find({}).populate('user', 'name username').lean().then((rows) =>
          rows.map((row) => ({
            employee: row.user?.name || row.user?.username || '-',
            clientName: row.clientName,
            dueDate: row.dueDate,
            status: row.status,
            note: row.note,
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
