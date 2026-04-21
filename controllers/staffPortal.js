const express = require('express');
const mongoose = require('mongoose');

const AttendanceLog = require('../models/attendanceLog');
const DailyReport = require('../models/dailyReport');
const SalesOrder = require('../models/salesOrder');
const Client = require('../models/client');
const ClientVisit = require('../models/clientVisit');
const Notification = require('../models/notification');
const MessageThread = require('../models/messageThread');

const requireAuthUser = require('../middleware/require-auth-user');
const requireRoles = require('../middleware/require-roles');
const { ok, fail } = require('../utils/respond');
const { logActivity } = require('../services/activity-log-service');
const { sendSalesOrderEmail, createTallyBridgePayload } = require('../services/order-notification-service');
const { sendPushToAdmins } = require('../services/push-notification-service');
const { toCsv } = require('../utils/csv');
const User = require('../models/user');

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
const getOwnFilter = (req, extra = {}) => ({ user: req.user._id, ...extra });
const cleanOptionalText = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};
const formatOrderItem = (item) =>
  `${item.productName || '-'} x${item.quantity || 0}${item.uom ? ` ${item.uom}` : ''}${item.price !== undefined ? ` @ ${item.price}` : ''}`;

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

const notifyAdmins = async ({ title, message, type = 'info', relatedModule, relatedRecord, pushUrl, pushTag, pushData }) => {
  const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
  if (admins.length) {
    await Notification.insertMany(
      admins.map((admin) => ({
        user: admin._id,
        title,
        message,
        type,
        relatedModule,
        relatedRecord,
      })),
      { ordered: false }
    ).catch(() => {});
  }

  await sendPushToAdmins({
    title,
    body: message,
    url: pushUrl,
    tag: pushTag,
    data: pushData,
  });
};

const displayStaffName = (user) => String(user?.name || user?.username || 'Staff').trim() || 'Staff';

const mapThreadForResponse = async (thread) => {
  await thread.populate('messages.sender', 'name username role');
  return {
    _id: thread._id,
    staffUser: thread.staffUser,
    updatedAt: thread.updatedAt,
    unreadAdminCount: thread.messages.filter((entry) => entry.senderRole === 'admin' && !entry.readByStaff).length,
    messages: thread.messages.map((entry) => ({
      _id: entry._id,
      text: entry.text || '',
      attachments: entry.attachments || [],
      senderRole: entry.senderRole,
      sender: entry.sender,
      readByAdmin: entry.readByAdmin,
      readByStaff: entry.readByStaff,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
  };
};

const exportCsv = (res, filename, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(toCsv(rows));
};

const getOwnedClientFilter = (userId) => ({
  $or: [{ assignedTo: userId }, { createdBy: userId }],
});

router.use(requireAuthUser, requireRoles('sales_staff'));

router.get('/dashboard', async (req, res, next) => {
  try {
    const [attendance, reports, notifications, recentOrders] = await Promise.all([
      AttendanceLog.findOne(getOwnFilter(req, { date: todayKey() })),
      DailyReport.find(getOwnFilter(req)).sort({ createdAt: -1 }).limit(3),
      Notification.find({ user: req.user._id, read: false }).sort({ createdAt: -1 }).limit(5),
      SalesOrder.find(getOwnFilter(req)).sort({ createdAt: -1 }).limit(3),
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
      notifications,
      quickStats: {
        unreadNotifications: notifications.length,
        recentOrders: recentOrders.length,
      },
      recentActivity: [
        ...recentOrders.map((record) => toRecentActivityItem(record, 'Order submitted')),
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

router.post('/attendance/mileage', async (req, res, next) => {
  try {
    const { mileageWeekStart, mileageWeekEnd, note } = req.body;
    if (
      (mileageWeekStart === undefined || mileageWeekStart === '') &&
      (mileageWeekEnd === undefined || mileageWeekEnd === '')
    ) {
      return fail(res, 'Enter daily start or daily end mileage.', 400);
    }

    const date = todayKey();
    const record = (await AttendanceLog.findOne(getOwnFilter(req, { date }))) || new AttendanceLog({ user: req.user._id, date });

    if (mileageWeekStart !== undefined && mileageWeekStart !== '') {
      const value = Number(mileageWeekStart);
      if (!Number.isNaN(value)) {
        record.mileageWeekStart = value;
        record.mileageWeekStartAt = new Date();
      }
    }

    if (mileageWeekEnd !== undefined && mileageWeekEnd !== '') {
      const value = Number(mileageWeekEnd);
      if (!Number.isNaN(value)) {
        record.mileageWeekEnd = value;
        record.mileageWeekEndAt = new Date();
      }
    }

    if (typeof note === 'string' && note.trim()) {
      record.checkOutNote = record.checkOutNote
        ? `${record.checkOutNote}\nMileage note: ${note.trim()}`
        : `Mileage note: ${note.trim()}`;
    }

    await record.save();

    await logActivity({
      user: req.user,
      action: 'mileage_updated',
      module: 'attendance',
      recordId: record._id,
      metadata: {
        date,
        mileageWeekStart: record.mileageWeekStart,
        mileageWeekEnd: record.mileageWeekEnd,
      },
    });

    return ok(res, { record }, 'Daily mileage saved.');
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
      summary: String(summary).trim(),
      visits,
      followUpNeeded,
      notes: cleanOptionalText(notes),
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
    const orders = await SalesOrder.find(getOwnFilter(req))
      .sort({ createdAt: -1 })
      .populate('client', 'name contactPerson phone email location');
    return ok(res, { orders });
  } catch (error) {
    return next(error);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const { client, customerName, companyName, contactPerson, items = [], notes, urgency, vatApplicable, vatAmount, deliveryNote } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return fail(res, 'At least one order item is required.', 400);
    }

    const attachments = Array.isArray(req.body.attachments)
      ? req.body.attachments
          .filter((entry) => entry?.url)
          .map((entry) => ({
            name: String(entry.name || '').trim() || 'Attachment',
            url: String(entry.url || '').trim(),
            mimeType: String(entry.mimeType || '').trim(),
          }))
      : [];

    let clientRecord = null;
    if (client) {
      if (!isValidObjectId(client)) return fail(res, 'Invalid client id.', 400);
      clientRecord = await Client.findOne({ _id: client, ...getOwnedClientFilter(req.user._id) });
      if (!clientRecord) return fail(res, 'Selected client was not found in your client list.', 404);
    }

    const resolvedCustomerName = String(customerName || clientRecord?.contactPerson || clientRecord?.name || '').trim();
    const resolvedCompanyName = String(companyName || clientRecord?.name || '').trim();
    const resolvedContactPerson = String(contactPerson || clientRecord?.contactPerson || '').trim();
    const normalizedItems = items
      .map((item) => ({
        productName: String(item?.productName || '').trim(),
        quantity: Number(item?.quantity) > 0 ? Number(item.quantity) : 1,
        ...(cleanOptionalText(item?.uom) ? { uom: cleanOptionalText(item.uom) } : {}),
        ...(item?.price !== undefined && item?.price !== null && item?.price !== ''
          ? { price: Number(item.price) || 0 }
          : {}),
      }))
      .filter((item) => item.productName);

    if (!normalizedItems.length) {
      return fail(res, 'At least one valid order item is required.', 400);
    }

    if (!resolvedCustomerName) {
      return fail(res, 'Customer name is required. Select a client or enter a contact name.', 400);
    }

    const normalizedVatApplicable = Boolean(vatApplicable);
    const normalizedVatAmount =
      normalizedVatApplicable && vatAmount !== undefined && vatAmount !== null && vatAmount !== ''
        ? Number(vatAmount)
        : undefined;

    const order = await SalesOrder.create({
      user: req.user._id,
      client: clientRecord?._id,
      customerName: resolvedCustomerName,
      companyName: resolvedCompanyName,
      contactPerson: resolvedContactPerson,
      items: normalizedItems,
      attachments,
      notes,
      urgency,
      vatApplicable: normalizedVatApplicable,
      ...(normalizedVatAmount !== undefined && !Number.isNaN(normalizedVatAmount) ? { vatAmount: normalizedVatAmount } : {}),
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

    await notifyAdmins({
      title: `New sales order from ${displayStaffName(req.user)}`,
      message: `${displayStaffName(req.user)} submitted an order for ${order.companyName || order.customerName}.`,
      type: 'info',
      relatedModule: 'sales_order',
      relatedRecord: order._id,
      pushUrl: `/admin/orders?focus=${encodeURIComponent(String(order._id))}`,
      pushTag: `sales-order-${order._id}`,
      pushData: { orderId: String(order._id) },
    });

    return ok(res, { order }, 'Order submitted.', 201);
  } catch (error) {
    return next(error);
  }
});

router.get('/orders/export', async (req, res, next) => {
  try {
    const orders = await SalesOrder.find(getOwnFilter(req))
      .sort({ createdAt: -1 })
      .populate('client', 'name contactPerson phone email location')
      .lean();

    await logActivity({
      user: req.user,
      action: 'orders_exported',
      module: 'sales_order',
      metadata: { count: orders.length },
    });

    return exportCsv(
      res,
      `staff-orders-${req.user.username || req.user._id}.csv`,
      orders.map((order) => ({
        submittedAt: order.createdAt?.toISOString?.() || '',
        status: order.status || '',
        clientName: order.client?.name || '',
        customerName: order.customerName || '',
        companyName: order.companyName || '',
        contactPerson: order.contactPerson || '',
        urgency: order.urgency || '',
        vatApplicable: order.vatApplicable ? 'Yes' : 'No',
        vatAmount: order.vatAmount ?? '',
        deliveryNote: order.deliveryNote || '',
        items: (order.items || []).map((item) => formatOrderItem(item)).join(' | '),
        notes: order.notes || '',
        attachments: (order.attachments || []).map((attachment) => attachment.url).join(' | '),
        emailSent: order.emailSent ? 'Yes' : 'No',
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.get('/clients', async (req, res, next) => {
  try {
    const clients = await Client.find(getOwnedClientFilter(req.user._id)).sort({ updatedAt: -1 });
    return ok(res, { clients });
  } catch (error) {
    return next(error);
  }
});

router.get('/clients/export', async (req, res, next) => {
  try {
    const clients = await Client.find(getOwnedClientFilter(req.user._id)).sort({ updatedAt: -1 }).lean();
    await logActivity({
      user: req.user,
      action: 'clients_exported',
      module: 'client',
      metadata: { count: clients.length },
    });
    return exportCsv(
      res,
      `staff-clients-${req.user.username || req.user._id}.csv`,
      clients.map((client) => ({
        name: client.name || '',
        companyType: client.companyType || '',
        department: client.department || '',
        contactPerson: client.contactPerson || '',
        phone: client.phone || '',
        email: client.email || '',
        location: client.location || '',
        address: client.address || '',
        notes: client.notes || '',
        createdAt: client.createdAt?.toISOString?.() || '',
        updatedAt: client.updatedAt?.toISOString?.() || '',
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post('/clients', async (req, res, next) => {
  try {
    const { name, companyType, department, contactPerson, phone, email, address, location, notes } = req.body;
    if (!name || !String(name).trim()) return fail(res, 'Client name is required.', 400);

    const client = await Client.create({
      name: String(name).trim(),
      companyType: cleanOptionalText(companyType),
      department: cleanOptionalText(department),
      contactPerson: cleanOptionalText(contactPerson),
      phone: cleanOptionalText(phone),
      email: cleanOptionalText(email),
      address: cleanOptionalText(address),
      location: cleanOptionalText(location),
      notes: cleanOptionalText(notes),
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
      ...getOwnedClientFilter(req.user._id),
    });
    if (!client) return fail(res, 'Client not found.', 404);

    ['name', 'companyType', 'department', 'contactPerson', 'phone', 'email', 'address', 'location', 'notes'].forEach((field) => {
      if (req.body[field] === undefined) return;
      client[field] = field === 'name' ? String(req.body[field] || '').trim() : cleanOptionalText(req.body[field]);
    });
    if (!client.name) return fail(res, 'Client name is required.', 400);
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
    const { client, clientName, visitDate, visitTime, location, metPerson, purpose, discussionSummary, outcome, relatedSchedule } =
      req.body;
    if (!visitDate || !purpose || !String(purpose).trim()) return fail(res, 'Visit date and purpose are required.', 400);

    const visit = await ClientVisit.create({
      user: req.user._id,
      client: isValidObjectId(client) ? client : undefined,
      clientName: cleanOptionalText(clientName),
      visitDate,
      visitTime: cleanOptionalText(visitTime),
      location: cleanOptionalText(location),
      metPerson: cleanOptionalText(metPerson),
      purpose: String(purpose).trim(),
      discussionSummary: cleanOptionalText(discussionSummary),
      outcome: cleanOptionalText(outcome),
      relatedSchedule: isValidObjectId(relatedSchedule) ? relatedSchedule : undefined,
    });

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

router.patch('/notifications/read-all', async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user._id, read: false },
      { $set: { read: true } }
    );
    return ok(res, { updated: result.modifiedCount || 0 }, 'All notifications marked as read.');
  } catch (error) {
    return next(error);
  }
});

router.get('/messages', async (req, res, next) => {
  try {
    let thread = await MessageThread.findOne({ staffUser: req.user._id });
    if (!thread) {
      thread = await MessageThread.create({ staffUser: req.user._id, messages: [] });
    }
    return ok(res, { thread: await mapThreadForResponse(thread) });
  } catch (error) {
    return next(error);
  }
});

router.post('/messages', async (req, res, next) => {
  try {
    const text = String(req.body.text || '').trim();
    const attachments = Array.isArray(req.body.attachments)
      ? req.body.attachments
          .filter((entry) => entry?.url)
          .map((entry) => ({
            name: String(entry.name || '').trim() || 'Attachment',
            url: String(entry.url || '').trim(),
            mimeType: String(entry.mimeType || '').trim(),
          }))
      : [];

    if (!text && !attachments.length) {
      return fail(res, 'Add a message or at least one attachment.', 400);
    }

    const thread =
      (await MessageThread.findOne({ staffUser: req.user._id })) ||
      (await MessageThread.create({ staffUser: req.user._id, messages: [] }));

    thread.messages.push({
      sender: req.user._id,
      senderRole: 'sales_staff',
      text,
      attachments,
      readByAdmin: false,
      readByStaff: true,
    });
    await thread.save();

    await createNotification({
      user: req.user._id,
      title: 'Message sent to office',
      message: text || `${attachments.length} attachment(s) sent`,
      type: 'info',
      relatedModule: 'messages',
      relatedRecord: thread._id,
    });

    await logActivity({
      user: req.user,
      action: 'message_sent',
      module: 'messages',
      recordId: thread._id,
      metadata: { attachmentCount: attachments.length },
    });

    await notifyAdmins({
      title: `New message from ${displayStaffName(req.user)}`,
      message: text || `${displayStaffName(req.user)} sent ${attachments.length} attachment(s).`,
      type: 'info',
      relatedModule: 'messages',
      relatedRecord: thread._id,
      pushUrl: `/admin/messages?staffId=${encodeURIComponent(String(req.user._id))}`,
      pushTag: `staff-message-${thread._id}`,
      pushData: { threadId: String(thread._id), staffUserId: String(req.user._id) },
    });

    return ok(res, { thread: await mapThreadForResponse(thread) }, 'Message sent.', 201);
  } catch (error) {
    return next(error);
  }
});

router.patch('/messages/read', async (req, res, next) => {
  try {
    const thread = await MessageThread.findOne({ staffUser: req.user._id });
    if (!thread) {
      return ok(res, { updated: 0 }, 'No messages to mark as read.');
    }
    let updated = 0;
    thread.messages.forEach((entry) => {
      if (entry.senderRole === 'admin' && !entry.readByStaff) {
        entry.readByStaff = true;
        updated += 1;
      }
    });
    if (updated) await thread.save();
    return ok(res, { updated }, 'Messages marked as read.');
  } catch (error) {
    return next(error);
  }
});

router.use((error, req, res, next) => {
  console.error('[staff-portal]', error);
  return fail(res, error.message || 'Staff portal request failed.', 500);
});

module.exports = router;
