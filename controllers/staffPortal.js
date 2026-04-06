const express = require('express');
const mongoose = require('mongoose');

const AttendanceLog = require('../models/attendanceLog');
const Schedule = require('../models/schedule');
const DailyReport = require('../models/dailyReport');
const SalesOrder = require('../models/salesOrder');
const ExpenseRequest = require('../models/expenseRequest');
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
const { sendSalesOrderEmail, createTallyBridgePayload } = require('../services/order-notification-service');

const router = express.Router();

const isValidObjectId = (value) => mongoose.isValidObjectId(value);
const todayKey = () => new Date().toISOString().slice(0, 10);
const getOwnFilter = (req, extra = {}) => ({ user: req.user._id, ...extra });

const toRecentActivityItem = (record, label) => ({
  id: record._id,
  label,
  createdAt: record.createdAt,
});

const createNotification = async ({ user, title, message, type = 'info', relatedModule, relatedRecord }) =>
  Notification.create({
    user,
    title,
    message,
    type,
    relatedModule,
    relatedRecord,
  });

router.use(requireAuthUser, requireRoles('sales_staff'));

router.get('/dashboard', async (req, res, next) => {
  try {
    const [attendance, schedules, reports, followUps, notifications, recentOrders, recentExpenses] = await Promise.all([
      AttendanceLog.findOne(getOwnFilter(req, { date: todayKey() })),
      Schedule.find(getOwnFilter(req, { assignedDate: todayKey() })).sort({ startTime: 1 }).limit(10).populate('client', 'name'),
      DailyReport.find(getOwnFilter(req)).sort({ createdAt: -1 }).limit(3),
      FollowUp.find(getOwnFilter(req, { status: 'pending' })).sort({ dueDate: 1 }).limit(5).populate('client', 'name'),
      Notification.find({ user: req.user._id, read: false }).sort({ createdAt: -1 }).limit(5),
      SalesOrder.find(getOwnFilter(req)).sort({ createdAt: -1 }).limit(3),
      ExpenseRequest.find(getOwnFilter(req)).sort({ createdAt: -1 }).limit(3),
    ]);

    return ok(res, {
      today: todayKey(),
      user: req.user,
      attendanceStatus: attendance
        ? {
            checkedIn: Boolean(attendance.checkInTime),
            checkedOut: Boolean(attendance.checkOutTime),
            checkInTime: attendance.checkInTime,
            checkOutTime: attendance.checkOutTime,
          }
        : { checkedIn: false, checkedOut: false },
      schedules,
      dueFollowUps: followUps,
      notifications,
      quickStats: {
        unreadNotifications: notifications.length,
        pendingFollowUps: followUps.length,
        recentOrders: recentOrders.length,
        recentExpenses: recentExpenses.length,
      },
      recentActivity: [
        ...recentOrders.map((record) => toRecentActivityItem(record, 'Order submitted')),
        ...recentExpenses.map((record) => toRecentActivityItem(record, 'Expense submitted')),
        ...reports.map((record) => toRecentActivityItem(record, 'Daily report submitted')),
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/attendance', async (req, res, next) => {
  try {
    const records = await AttendanceLog.find(getOwnFilter(req)).sort({ date: -1 }).limit(30);
    return ok(res, { records });
  } catch (error) {
    return next(error);
  }
});

router.post('/attendance/check-in', async (req, res, next) => {
  try {
    const date = todayKey();
    const existing = await AttendanceLog.findOne(getOwnFilter(req, { date }));
    if (existing?.checkInTime) {
      return fail(res, 'You have already checked in today.', 409);
    }

    const record = existing || new AttendanceLog({ user: req.user._id, date });
    record.checkInTime = new Date();
    record.checkInNote = req.body.note || '';
    if (req.body.mileageWeekStart !== undefined && req.body.mileageWeekStart !== '') {
      const mileageWeekStart = Number(req.body.mileageWeekStart);
      if (!Number.isNaN(mileageWeekStart)) record.mileageWeekStart = mileageWeekStart;
    }
    if (req.body.mileageWeekEnd !== undefined && req.body.mileageWeekEnd !== '') {
      const mileageWeekEnd = Number(req.body.mileageWeekEnd);
      if (!Number.isNaN(mileageWeekEnd)) record.mileageWeekEnd = mileageWeekEnd;
    }
    await record.save();

    await logActivity({
      user: req.user,
      action: 'check_in',
      module: 'attendance',
      recordId: record._id,
      metadata: { date },
    });

    return ok(res, { record }, 'Checked in successfully.', 201);
  } catch (error) {
    return next(error);
  }
});

router.post('/attendance/check-out', async (req, res, next) => {
  try {
    const date = todayKey();
    const record = await AttendanceLog.findOne(getOwnFilter(req, { date }));
    if (!record?.checkInTime) {
      return fail(res, 'You must check in first.', 400);
    }
    if (record.checkOutTime) {
      return fail(res, 'You have already checked out today.', 409);
    }

    record.checkOutTime = new Date();
    record.checkOutNote = req.body.note || '';
    if (req.body.mileageWeekStart !== undefined && req.body.mileageWeekStart !== '') {
      const mileageWeekStart = Number(req.body.mileageWeekStart);
      if (!Number.isNaN(mileageWeekStart)) record.mileageWeekStart = mileageWeekStart;
    }
    if (req.body.mileageWeekEnd !== undefined && req.body.mileageWeekEnd !== '') {
      const mileageWeekEnd = Number(req.body.mileageWeekEnd);
      if (!Number.isNaN(mileageWeekEnd)) record.mileageWeekEnd = mileageWeekEnd;
    }
    record.totalWorkedMinutes = Math.max(0, Math.round((record.checkOutTime - record.checkInTime) / 60000));
    await record.save();

    await logActivity({
      user: req.user,
      action: 'check_out',
      module: 'attendance',
      recordId: record._id,
      metadata: { date, totalWorkedMinutes: record.totalWorkedMinutes },
    });

    return ok(res, { record }, 'Checked out successfully.');
  } catch (error) {
    return next(error);
  }
});

router.get('/schedules', async (req, res, next) => {
  try {
    const filters = getOwnFilter(req);
    if (req.query.date) filters.assignedDate = req.query.date;
    if (req.query.status) filters.status = req.query.status;
    const schedules = await Schedule.find(filters).sort({ assignedDate: 1, startTime: 1 }).populate('client', 'name');
    return ok(res, { schedules });
  } catch (error) {
    return next(error);
  }
});

router.patch('/schedules/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid schedule id.', 400);
    const schedule = await Schedule.findOne({ _id: req.params.id, user: req.user._id });
    if (!schedule) return fail(res, 'Schedule not found.', 404);

    if (req.body.status) schedule.status = req.body.status;
    if (typeof req.body.notes === 'string') schedule.notes = req.body.notes;
    await schedule.save();

    await logActivity({
      user: req.user,
      action: 'schedule_updated',
      module: 'schedule',
      recordId: schedule._id,
      metadata: { status: schedule.status },
    });

    return ok(res, { schedule }, 'Schedule updated.');
  } catch (error) {
    return next(error);
  }
});

router.get('/reports', async (req, res, next) => {
  try {
    const reports = await DailyReport.find(getOwnFilter(req)).sort({ date: -1, createdAt: -1 }).populate('relatedSchedule');
    return ok(res, { reports });
  } catch (error) {
    return next(error);
  }
});

router.post('/reports', async (req, res, next) => {
  try {
    const { date, summary, visits = [], followUpNeeded = false, notes, relatedSchedule } = req.body;
    if (!date || !summary) return fail(res, 'Date and summary are required.', 400);

    const report = await DailyReport.create({
      user: req.user._id,
      date,
      summary,
      visits,
      followUpNeeded,
      notes,
      relatedSchedule: isValidObjectId(relatedSchedule) ? relatedSchedule : undefined,
    });

    await logActivity({
      user: req.user,
      action: 'daily_report_submitted',
      module: 'daily_report',
      recordId: report._id,
      metadata: { date },
    });

    return ok(res, { report }, 'Daily report submitted.', 201);
  } catch (error) {
    return next(error);
  }
});

router.get('/orders', async (req, res, next) => {
  try {
    const orders = await SalesOrder.find(getOwnFilter(req)).sort({ createdAt: -1 }).populate('client', 'name');
    return ok(res, { orders });
  } catch (error) {
    return next(error);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const { client, customerName, companyName, contactPerson, items = [], notes, urgency, deliveryNote } = req.body;
    if (!customerName || !Array.isArray(items) || !items.length) {
      return fail(res, 'Customer name and at least one order item are required.', 400);
    }

    const order = await SalesOrder.create({
      user: req.user._id,
      client: isValidObjectId(client) ? client : undefined,
      customerName,
      companyName,
      contactPerson,
      items,
      notes,
      urgency,
      deliveryNote,
      submittedAt: new Date(),
      statusHistory: [{ status: 'submitted', note: 'Order submitted by staff user', changedBy: req.user._id }],
      ...createTallyBridgePayload({ order: { _id: undefined } }),
    });

    const emailResult = await sendSalesOrderEmail({ order, staff: req.user });
    order.emailSent = Boolean(emailResult.sent);
    order.emailSentAt = emailResult.sent ? new Date() : undefined;
    order.emailError = emailResult.sent ? undefined : emailResult.reason || undefined;
    if (emailResult.sent) {
      order.status = 'emailed';
      order.statusHistory.push({
        status: 'emailed',
        note: 'Order email sent to company mailbox',
        changedBy: req.user._id,
      });
    }
    await order.save();

    await logActivity({
      user: req.user,
      action: 'sales_order_submitted',
      module: 'sales_order',
      recordId: order._id,
      metadata: { emailSent: order.emailSent },
    });

    return ok(res, { order }, 'Order submitted.', 201);
  } catch (error) {
    return next(error);
  }
});

router.get('/expenses', async (req, res, next) => {
  try {
    const expenses = await ExpenseRequest.find(getOwnFilter(req)).sort({ createdAt: -1 }).populate('relatedClient', 'name');
    return ok(res, { expenses });
  } catch (error) {
    return next(error);
  }
});

router.post('/expenses', async (req, res, next) => {
  try {
    const { title, category, amount, expenseDate, description, relatedReference, relatedClient, receiptUrl, paymentMethod } = req.body;
    if (!title || !category || amount === undefined || !expenseDate) {
      return fail(res, 'Title, category, amount, and expense date are required.', 400);
    }

    const expense = await ExpenseRequest.create({
      user: req.user._id,
      title,
      category,
      amount,
      expenseDate,
      description,
      relatedReference,
      relatedClient: isValidObjectId(relatedClient) ? relatedClient : undefined,
      receiptUrl,
      paymentMethod,
    });

    await logActivity({
      user: req.user,
      action: 'expense_submitted',
      module: 'expense_request',
      recordId: expense._id,
      metadata: { amount },
    });

    return ok(res, { expense }, 'Expense request submitted.', 201);
  } catch (error) {
    return next(error);
  }
});

router.get('/clients', async (req, res, next) => {
  try {
    const clients = await Client.find({
      $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }],
    }).sort({ updatedAt: -1 });
    return ok(res, { clients });
  } catch (error) {
    return next(error);
  }
});

router.post('/clients', async (req, res, next) => {
  try {
    const { name, companyType, department, contactPerson, phone, email, address, location, notes } = req.body;
    if (!name) return fail(res, 'Client name is required.', 400);

    const client = await Client.create({
      name,
      companyType,
      department,
      contactPerson,
      phone,
      email,
      address,
      location,
      notes,
      assignedTo: req.user._id,
      createdBy: req.user._id,
    });

    await logActivity({
      user: req.user,
      action: 'client_created',
      module: 'client',
      recordId: client._id,
      metadata: { name: client.name },
    });

    return ok(res, { client }, 'Client created.', 201);
  } catch (error) {
    return next(error);
  }
});

router.patch('/clients/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid client id.', 400);
    const client = await Client.findOne({
      _id: req.params.id,
      $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }],
    });
    if (!client) return fail(res, 'Client not found.', 404);

    ['name', 'companyType', 'department', 'contactPerson', 'phone', 'email', 'address', 'location', 'notes'].forEach((field) => {
      if (req.body[field] !== undefined) client[field] = req.body[field];
    });
    await client.save();

    await logActivity({
      user: req.user,
      action: 'client_updated',
      module: 'client',
      recordId: client._id,
      metadata: { name: client.name },
    });

    return ok(res, { client }, 'Client updated.');
  } catch (error) {
    return next(error);
  }
});

router.get('/visits', async (req, res, next) => {
  try {
    const visits = await ClientVisit.find(getOwnFilter(req)).sort({ visitDate: -1, createdAt: -1 }).populate('client relatedSchedule');
    return ok(res, { visits });
  } catch (error) {
    return next(error);
  }
});

router.post('/visits', async (req, res, next) => {
  try {
    const { client, clientName, visitDate, visitTime, location, metPerson, purpose, discussionSummary, outcome, followUpDate, relatedSchedule } =
      req.body;
    if (!visitDate || !purpose) return fail(res, 'Visit date and purpose are required.', 400);

    const visit = await ClientVisit.create({
      user: req.user._id,
      client: isValidObjectId(client) ? client : undefined,
      clientName,
      visitDate,
      visitTime,
      location,
      metPerson,
      purpose,
      discussionSummary,
      outcome,
      followUpDate,
      relatedSchedule: isValidObjectId(relatedSchedule) ? relatedSchedule : undefined,
    });

    if (followUpDate) {
      await FollowUp.create({
        user: req.user._id,
        client: visit.client,
        clientName: visit.clientName,
        relatedRecordType: 'visit',
        relatedRecord: visit._id,
        dueDate: followUpDate,
        note: `Follow-up from visit: ${purpose}`,
      });
    }

    await logActivity({
      user: req.user,
      action: 'client_visit_logged',
      module: 'client_visit',
      recordId: visit._id,
      metadata: { visitDate },
    });

    return ok(res, { visit }, 'Visit logged.', 201);
  } catch (error) {
    return next(error);
  }
});

router.get('/followups', async (req, res, next) => {
  try {
    const filters = getOwnFilter(req);
    if (req.query.status) filters.status = req.query.status;
    const followUps = await FollowUp.find(filters).sort({ dueDate: 1, createdAt: -1 }).populate('client');
    return ok(res, { followUps });
  } catch (error) {
    return next(error);
  }
});

router.post('/followups', async (req, res, next) => {
  try {
    const { client, clientName, relatedRecordType, relatedRecord, dueDate, note } = req.body;
    if (!dueDate || !note) return fail(res, 'Due date and note are required.', 400);

    const followUp = await FollowUp.create({
      user: req.user._id,
      client: isValidObjectId(client) ? client : undefined,
      clientName,
      relatedRecordType,
      relatedRecord,
      dueDate,
      note,
    });

    await logActivity({
      user: req.user,
      action: 'follow_up_created',
      module: 'follow_up',
      recordId: followUp._id,
      metadata: { dueDate },
    });

    return ok(res, { followUp }, 'Follow-up created.', 201);
  } catch (error) {
    return next(error);
  }
});

router.patch('/followups/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid follow-up id.', 400);
    const followUp = await FollowUp.findOne({ _id: req.params.id, user: req.user._id });
    if (!followUp) return fail(res, 'Follow-up not found.', 404);

    if (req.body.status) followUp.status = req.body.status;
    if (req.body.note !== undefined) followUp.note = req.body.note;
    if (req.body.dueDate) followUp.dueDate = req.body.dueDate;
    await followUp.save();

    await logActivity({
      user: req.user,
      action: 'follow_up_updated',
      module: 'follow_up',
      recordId: followUp._id,
      metadata: { status: followUp.status },
    });

    return ok(res, { followUp }, 'Follow-up updated.');
  } catch (error) {
    return next(error);
  }
});

router.get('/quotations', async (req, res, next) => {
  try {
    const quotations = await Quotation.find(getOwnFilter(req)).sort({ createdAt: -1 }).populate('client');
    return ok(res, { quotations });
  } catch (error) {
    return next(error);
  }
});

router.post('/quotations', async (req, res, next) => {
  try {
    const quotation = await Quotation.create({
      ...req.body,
      user: req.user._id,
      client: isValidObjectId(req.body.client) ? req.body.client : undefined,
    });

    await logActivity({
      user: req.user,
      action: 'quotation_created',
      module: 'quotation',
      recordId: quotation._id,
    });

    return ok(res, { quotation }, 'Quotation saved.', 201);
  } catch (error) {
    return next(error);
  }
});

router.patch('/quotations/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid quotation id.', 400);
    const quotation = await Quotation.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, req.body, { new: true });
    if (!quotation) return fail(res, 'Quotation not found.', 404);
    await logActivity({ user: req.user, action: 'quotation_updated', module: 'quotation', recordId: quotation._id });
    return ok(res, { quotation }, 'Quotation updated.');
  } catch (error) {
    return next(error);
  }
});

router.get('/collections', async (req, res, next) => {
  try {
    const collections = await CollectionLog.find(getOwnFilter(req)).sort({ createdAt: -1 }).populate('client');
    return ok(res, { collections });
  } catch (error) {
    return next(error);
  }
});

router.post('/collections', async (req, res, next) => {
  try {
    const collection = await CollectionLog.create({
      ...req.body,
      user: req.user._id,
      client: isValidObjectId(req.body.client) ? req.body.client : undefined,
    });
    await logActivity({ user: req.user, action: 'collection_logged', module: 'collection', recordId: collection._id });
    return ok(res, { collection }, 'Collection log saved.', 201);
  } catch (error) {
    return next(error);
  }
});

router.patch('/collections/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid collection id.', 400);
    const collection = await CollectionLog.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, req.body, { new: true });
    if (!collection) return fail(res, 'Collection not found.', 404);
    await logActivity({ user: req.user, action: 'collection_updated', module: 'collection', recordId: collection._id });
    return ok(res, { collection }, 'Collection updated.');
  } catch (error) {
    return next(error);
  }
});

router.get('/stock-requests', async (req, res, next) => {
  try {
    const requests = await StockRequest.find(getOwnFilter(req)).sort({ createdAt: -1 });
    return ok(res, { requests });
  } catch (error) {
    return next(error);
  }
});

router.post('/stock-requests', async (req, res, next) => {
  try {
    const request = await StockRequest.create({ ...req.body, user: req.user._id });
    await logActivity({ user: req.user, action: 'stock_request_submitted', module: 'stock_request', recordId: request._id });
    return ok(res, { request }, 'Request submitted.', 201);
  } catch (error) {
    return next(error);
  }
});

router.get('/product-demands', async (req, res, next) => {
  try {
    const demands = await ProductDemand.find(getOwnFilter(req)).sort({ createdAt: -1 }).populate('client');
    return ok(res, { demands });
  } catch (error) {
    return next(error);
  }
});

router.post('/product-demands', async (req, res, next) => {
  try {
    const demand = await ProductDemand.create({
      ...req.body,
      user: req.user._id,
      client: isValidObjectId(req.body.client) ? req.body.client : undefined,
    });
    await logActivity({ user: req.user, action: 'product_demand_logged', module: 'product_demand', recordId: demand._id });
    return ok(res, { demand }, 'Demand logged.', 201);
  } catch (error) {
    return next(error);
  }
});

router.get('/issues', async (req, res, next) => {
  try {
    const issues = await IssueReport.find(getOwnFilter(req)).sort({ createdAt: -1 }).populate('client order');
    return ok(res, { issues });
  } catch (error) {
    return next(error);
  }
});

router.post('/issues', async (req, res, next) => {
  try {
    const issue = await IssueReport.create({
      ...req.body,
      user: req.user._id,
      client: isValidObjectId(req.body.client) ? req.body.client : undefined,
      order: isValidObjectId(req.body.order) ? req.body.order : undefined,
    });
    await logActivity({ user: req.user, action: 'issue_report_submitted', module: 'issue_report', recordId: issue._id });
    return ok(res, { issue }, 'Issue reported.', 201);
  } catch (error) {
    return next(error);
  }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    return ok(res, { notifications });
  } catch (error) {
    return next(error);
  }
});

router.patch('/notifications/:id/read', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid notification id.', 400);
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true },
      { new: true }
    );
    if (!notification) return fail(res, 'Notification not found.', 404);
    return ok(res, { notification }, 'Notification marked as read.');
  } catch (error) {
    return next(error);
  }
});

router.use((error, req, res, next) => {
  console.error('[staff-portal]', error);
  return fail(res, error.message || 'Staff portal request failed.', 500);
});

module.exports = router;
