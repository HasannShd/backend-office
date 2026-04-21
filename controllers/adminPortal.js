const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');

const User = require('../models/user');
const AttendanceLog = require('../models/attendanceLog');
const DailyReport = require('../models/dailyReport');
const SalesOrder = require('../models/salesOrder');
const Order = require('../models/order');
const ActivityLog = require('../models/activityLog');
const Client = require('../models/client');
const ClientVisit = require('../models/clientVisit');
const Notification = require('../models/notification');
const MessageThread = require('../models/messageThread');
const Product = require('../models/product');
const Category = require('../models/category');
const Schedule = require('../models/schedule');

const requireAuthUser = require('../middleware/require-auth-user');
const requireRoles = require('../middleware/require-roles');
const { ok, fail } = require('../utils/respond');
const { logActivity } = require('../services/activity-log-service');
const { sendPushToUser } = require('../services/push-notification-service');
const { toCsv } = require('../utils/csv');
const { validatePasswordStrength } = require('../utils/auth-security');
const { toExtendedJson } = require('../scripts/backupToDrive');

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
const formatOrderItem = (item) =>
  `${item.productName || item.name || '-'} x${item.quantity || 0}${item.uom ? ` ${item.uom}` : ''}${item.vatApplicable ? ` | VAT ${item.vatAmount ?? 'Yes'}` : ''}${item.size ? ` (${item.size})` : ''}${item.price !== undefined ? ` @ ${item.price}` : ''}`;

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

const sendStaffPushIfAvailable = async ({ userId, title, body, url, tag, data }) => {
  if (!userId) return { sent: 0, skipped: 1, failed: 0 };
  const staffUser = await User.findOne({
    _id: userId,
    role: 'sales_staff',
    isActive: true,
    'pushSubscriptions.0': { $exists: true },
  }).select('pushSubscriptions');

  if (!staffUser) {
    return { sent: 0, skipped: 1, failed: 0 };
  }

  return sendPushToUser({
    user: staffUser,
    title,
    body,
    url,
    tag,
    data,
  });
};

const mapThreadSummary = (thread) => ({
  _id: thread._id,
  staffUser: thread.staffUser,
  updatedAt: thread.updatedAt,
  lastMessage: thread.messages?.[thread.messages.length - 1]
    ? {
        text: thread.messages[thread.messages.length - 1].text || '',
        attachments: thread.messages[thread.messages.length - 1].attachments || [],
        senderRole: thread.messages[thread.messages.length - 1].senderRole,
        createdAt: thread.messages[thread.messages.length - 1].createdAt,
      }
    : null,
  unreadStaffCount: (thread.messages || []).filter((entry) => entry.senderRole === 'sales_staff' && !entry.readByAdmin).length,
});

const mapThreadDetails = async (thread) => {
  await thread.populate('staffUser', 'name username email phone department');
  await thread.populate('messages.sender', 'name username role');
  return {
    ...mapThreadSummary(thread),
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

const formatDateOnly = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PORTAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

const trimText = (value) => String(value || '').trim();
const csvCell = (value) => trimText(value).replace(/\s+/g, ' ');

const matchesDateFilter = (value, targetDate) => {
  if (!targetDate) return true;
  if (!value) return false;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value === targetDate;
  return formatDateOnly(value) === targetDate;
};

const autoFitWorksheet = (worksheet) => {
  worksheet.columns.forEach((column) => {
    let maxLength = 12;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const length = String(cell.value ?? '').length;
      if (length > maxLength) maxLength = Math.min(length + 2, 40);
    });
    column.width = maxLength;
  });
};

const isoDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const joinParts = (parts, separator = ' | ') =>
  parts
    .map((part) => trimText(part))
    .filter(Boolean)
    .join(separator);

const addWorksheet = (workbook, name, rows) => {
  const sheet = workbook.addWorksheet(name);
  const headers = Object.keys(rows[0] || {});
  sheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.min(Math.max(header.length + 4, 14), 40),
  }));
  if (rows.length) {
    sheet.addRows(rows);
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  autoFitWorksheet(sheet);
  return sheet;
};

const buildFullExportWorkbook = async () => {
  const [
    users,
    websiteOrders,
    categories,
    products,
    attendanceLogs,
    dailyReports,
    salesOrders,
    clients,
    clientVisits,
    schedules,
    notifications,
    messageThreads,
    activityLogs,
  ] = await Promise.all([
    User.find({})
      .select('-hashedPassword -resetPasswordTokenHash -resetPasswordExpiresAt -mfaSecretEncrypted -mfaPendingSecretEncrypted -mfaRecoveryCodeHashes -trustedDevices.tokenHash -pushSubscriptions.keys.auth -pushSubscriptions.keys.p256dh')
      .sort({ role: 1, createdAt: -1 })
      .lean(),
    Order.find({})
      .sort({ createdAt: -1 })
      .populate('user', 'name username email phone')
      .lean(),
    Category.find({})
      .populate('parent', 'name slug')
      .sort({ sortOrder: 1, name: 1 })
      .lean(),
    Product.find({})
      .populate({
        path: 'categorySlug',
        select: 'name slug parent',
        populate: { path: 'parent', select: 'name slug' },
      })
      .sort({ name: 1 })
      .lean(),
    AttendanceLog.find({})
      .sort({ date: -1, createdAt: -1 })
      .populate('user', 'name username department')
      .lean(),
    DailyReport.find({})
      .sort({ date: -1, createdAt: -1 })
      .populate('user relatedSchedule', 'name username title assignedDate')
      .lean(),
    SalesOrder.find({})
      .sort({ requestedForDate: -1, createdAt: -1 })
      .populate('user client', 'name username email phone location')
      .lean(),
    Client.find({})
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate('assignedTo createdBy', 'name username email phone')
      .lean(),
    ClientVisit.find({})
      .sort({ createdAt: -1 })
      .populate('user client relatedSchedule', 'name username title assignedDate')
      .lean(),
    Schedule.find({})
      .sort({ assignedDate: -1, createdAt: -1 })
      .populate('user client createdBy', 'name username email phone')
      .lean(),
    Notification.find({})
      .sort({ createdAt: -1 })
      .populate('user', 'name username role')
      .lean(),
    MessageThread.find({})
      .sort({ updatedAt: -1 })
      .populate('staffUser', 'name username email phone department')
      .populate('messages.sender', 'name username role')
      .lean(),
    ActivityLog.find({})
      .sort({ createdAt: -1 })
      .populate('user', 'name username role')
      .lean(),
  ]);

  const marketingContacts = users.filter((user) => user.marketingOptIn);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LTE Admin Portal';
  workbook.created = new Date();
  workbook.modified = new Date();

  addWorksheet(workbook, 'Summary', [
    {
      generatedAt: new Date().toISOString(),
      users: users.length,
      marketingContacts: marketingContacts.length,
      websiteOrders: websiteOrders.length,
      categories: categories.length,
      products: products.length,
      attendanceLogs: attendanceLogs.length,
      dailyReports: dailyReports.length,
      staffOrders: salesOrders.length,
      clients: clients.length,
      clientVisits: clientVisits.length,
      schedules: schedules.length,
      notifications: notifications.length,
      messageThreads: messageThreads.length,
      activityLogs: activityLogs.length,
    },
  ]);

  addWorksheet(
    workbook,
    'Users',
    users.map((user) => ({
      role: user.role || '',
      name: user.name || '',
      username: user.username || '',
      email: user.email || '',
      phone: user.phone || '',
      department: user.department || '',
      marketingOptIn: user.marketingOptIn ? 'Yes' : 'No',
      isActive: user.isActive ? 'Yes' : 'No',
      mfaEnabled: user.mfaEnabled ? 'Yes' : 'No',
      lastLoginAt: isoDate(user.lastLoginAt),
      passwordChangedAt: isoDate(user.passwordChangedAt),
      address: joinParts([
        user.address?.fullName,
        user.address?.phone,
        user.address?.line1,
        user.address?.line2,
        user.address?.city,
        user.address?.country,
        user.address?.postalCode,
      ], ', '),
      createdAt: isoDate(user.createdAt),
      updatedAt: isoDate(user.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Marketing Contacts',
    marketingContacts.map((user) => ({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      username: user.username || '',
      createdAt: isoDate(user.createdAt),
    }))
  );

  addWorksheet(
    workbook,
    'Website Orders',
    websiteOrders.map((order) => ({
      invoiceNumber: order.invoiceNumber || '',
      status: order.status || '',
      paymentMethod: order.paymentMethod || '',
      paymentStatus: order.paymentStatus || '',
      customerName: order.customer?.name || '',
      customerEmail: order.customer?.email || '',
      customerPhone: order.customer?.phone || '',
      accountName: order.user?.name || order.user?.username || '',
      shippingAddress: joinParts([
        order.shippingAddress?.fullName,
        order.shippingAddress?.phone,
        order.shippingAddress?.line1,
        order.shippingAddress?.line2,
        order.shippingAddress?.city,
        order.shippingAddress?.country,
        order.shippingAddress?.postalCode,
      ], ', '),
      items: (order.items || [])
        .map((item) => formatOrderItem(item))
        .join(' | '),
      subtotal: order.subtotal ?? 0,
      shippingFee: order.shippingFee ?? 0,
      total: order.total ?? 0,
      notes: csvCell(order.notes),
      createdAt: isoDate(order.createdAt),
      updatedAt: isoDate(order.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Categories',
    categories.map((category) => ({
      name: category.name || '',
      slug: category.slug || '',
      parent: category.parent?.name || '',
      parentSlug: category.parent?.slug || '',
      sortOrder: category.sortOrder ?? '',
      createdAt: isoDate(category.createdAt),
      updatedAt: isoDate(category.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Products',
    products.map((product) => ({
      name: product.name || '',
      brand: product.brand || '',
      category: product.categorySlug?.name || '',
      categorySlug: product.categorySlug?.slug || '',
      parentCategory: product.categorySlug?.parent?.name || '',
      sku: product.sku || '',
      basePrice: product.basePrice ?? '',
      featured: product.featured ? 'Yes' : 'No',
      isActive: product.isActive === false ? 'No' : 'Yes',
      image: product.image || '',
      description: csvCell(product.description),
      variants: (product.variants || [])
        .map((variant) => joinParts([variant.name || variant.type, variant.sku, variant.price !== undefined ? `price:${variant.price}` : '', variant.stock !== undefined ? `stock:${variant.stock}` : '']))
        .filter(Boolean)
        .join(' | '),
      createdAt: isoDate(product.createdAt),
      updatedAt: isoDate(product.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Attendance',
    attendanceLogs.map((entry) => ({
      employee: entry.user?.name || entry.user?.username || '',
      department: entry.user?.department || '',
      date: entry.date || '',
      checkInTime: isoDate(entry.checkInTime),
      checkOutTime: isoDate(entry.checkOutTime),
      totalWorkedMinutes: entry.totalWorkedMinutes ?? 0,
      mileageWeekStart: entry.mileageWeekStart ?? '',
      mileageWeekStartAt: isoDate(entry.mileageWeekStartAt),
      mileageWeekEnd: entry.mileageWeekEnd ?? '',
      mileageWeekEndAt: isoDate(entry.mileageWeekEndAt),
      checkInNote: csvCell(entry.checkInNote),
      checkOutNote: csvCell(entry.checkOutNote),
      createdAt: isoDate(entry.createdAt),
      updatedAt: isoDate(entry.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Daily Reports',
    dailyReports.map((entry) => ({
      employee: entry.user?.name || entry.user?.username || '',
      date: entry.date || '',
      summary: csvCell(entry.summary),
      notes: csvCell(entry.notes),
      followUpNeeded: entry.followUpNeeded ? 'Yes' : 'No',
      relatedSchedule: entry.relatedSchedule?.title || '',
      visits: (entry.visits || []).map((visit) => `${visit.clientName || '-'}: ${csvCell(visit.outcome)}`).join(' | '),
      createdAt: isoDate(entry.createdAt),
      updatedAt: isoDate(entry.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Staff Orders',
    salesOrders.map((entry) => ({
      employee: entry.user?.name || entry.user?.username || '',
      client: entry.client?.name || '',
      customerName: entry.customerName || '',
      companyName: entry.companyName || '',
      contactPerson: entry.contactPerson || '',
      requestedForDate: entry.requestedForDate || '',
      orderTiming: entry.orderTiming || 'today',
      status: entry.status || '',
      urgency: entry.urgency || '',
      emailSent: entry.emailSent ? 'Yes' : 'No',
      emailSentAt: isoDate(entry.emailSentAt),
      emailError: csvCell(entry.emailError),
      items: (entry.items || [])
        .map((item) => formatOrderItem(item))
        .join(' | '),
      deliveryNote: csvCell(entry.deliveryNote),
      notes: csvCell(entry.notes),
      submittedAt: isoDate(entry.submittedAt || entry.createdAt),
      updatedAt: isoDate(entry.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Clients',
    clients.map((entry) => ({
      name: entry.name || '',
      companyType: entry.companyType || '',
      department: entry.department || '',
      contactPerson: entry.contactPerson || '',
      phone: entry.phone || '',
      email: entry.email || '',
      location: entry.location || '',
      address: csvCell(entry.address),
      assignedTo: entry.assignedTo?.name || entry.assignedTo?.username || '',
      createdBy: entry.createdBy?.name || entry.createdBy?.username || '',
      notes: csvCell(entry.notes),
      createdAt: isoDate(entry.createdAt),
      updatedAt: isoDate(entry.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Visits',
    clientVisits.map((entry) => ({
      employee: entry.user?.name || entry.user?.username || '',
      client: entry.client?.name || entry.clientName || '',
      visitDate: entry.visitDate || '',
      visitTime: entry.visitTime || '',
      metPerson: entry.metPerson || '',
      location: entry.location || '',
      purpose: entry.purpose || '',
      discussionSummary: csvCell(entry.discussionSummary),
      outcome: csvCell(entry.outcome),
      relatedSchedule: entry.relatedSchedule?.title || '',
      createdAt: isoDate(entry.createdAt),
      updatedAt: isoDate(entry.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Schedules',
    schedules.map((entry) => ({
      employee: entry.user?.name || entry.user?.username || '',
      title: entry.title || '',
      assignedDate: entry.assignedDate || '',
      startTime: entry.startTime || '',
      endTime: entry.endTime || '',
      client: entry.client?.name || entry.clientLabel || '',
      location: entry.location || '',
      status: entry.status || '',
      notes: csvCell(entry.notes),
      createdBy: entry.createdBy?.name || entry.createdBy?.username || '',
      createdAt: isoDate(entry.createdAt),
      updatedAt: isoDate(entry.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Notifications',
    notifications.map((entry) => ({
      user: entry.user?.name || entry.user?.username || '',
      role: entry.user?.role || '',
      title: entry.title || '',
      message: csvCell(entry.message),
      type: entry.type || '',
      read: entry.read ? 'Yes' : 'No',
      relatedModule: entry.relatedModule || '',
      relatedRecord: trimText(entry.relatedRecord),
      createdAt: isoDate(entry.createdAt),
      updatedAt: isoDate(entry.updatedAt),
    }))
  );

  addWorksheet(
    workbook,
    'Messages',
    messageThreads.flatMap((thread) =>
      (thread.messages || []).map((message) => ({
        staffUser: thread.staffUser?.name || thread.staffUser?.username || '',
        staffEmail: thread.staffUser?.email || '',
        staffPhone: thread.staffUser?.phone || '',
        sender: message.sender?.name || message.sender?.username || '',
        senderRole: message.senderRole || '',
        text: csvCell(message.text),
        attachments: (message.attachments || []).map((attachment) => attachment.name || attachment.url || '').join(' | '),
        readByAdmin: message.readByAdmin ? 'Yes' : 'No',
        readByStaff: message.readByStaff ? 'Yes' : 'No',
        createdAt: isoDate(message.createdAt),
        updatedAt: isoDate(message.updatedAt),
      }))
    )
  );

  addWorksheet(
    workbook,
    'Activity Logs',
    activityLogs.map((entry) => ({
      user: entry.user?.name || entry.user?.username || '',
      role: entry.user?.role || '',
      module: entry.module || '',
      action: entry.action || '',
      recordId: trimText(entry.recordId),
      metadata: trimText(JSON.stringify(entry.metadata || {})),
      createdAt: isoDate(entry.createdAt),
    }))
  );

  return workbook;
};

const buildFullRecoveryExportPayload = async () => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection is not ready.');
  }

  const collections = await db.collections();
  const exportedCollections = [];

  for (const collection of collections.sort((left, right) => left.collectionName.localeCompare(right.collectionName))) {
    const documents = await collection.find({}).toArray();
    exportedCollections.push({
      name: collection.collectionName,
      count: documents.length,
      documents: documents.map((document) => toExtendedJson(document)),
    });
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    database: db.databaseName,
    collections: exportedCollections,
  };
};

const buildStaffReportData = async (staffUser, selectedDate) => {
  const userFilter = { user: staffUser._id };
  const clientFilter = { $or: [{ assignedTo: staffUser._id }, { createdBy: staffUser._id }] };

  const [
    attendanceCount,
    reportsCount,
    ordersCount,
    pendingOrders,
    visitsCount,
    clientsCount,
    unreadNotifications,
    attendanceEntries,
    reportEntries,
    orderEntries,
    visitEntries,
    clientEntries,
    activityEntries,
  ] = await Promise.all([
    AttendanceLog.countDocuments(userFilter),
    DailyReport.countDocuments(userFilter),
    SalesOrder.countDocuments(userFilter),
    SalesOrder.countDocuments({ ...userFilter, status: { $in: ['submitted', 'reviewed', 'emailed', 'confirmed'] } }),
    ClientVisit.countDocuments(userFilter),
    Client.countDocuments(clientFilter),
    Notification.countDocuments({ user: staffUser._id, read: false }),
    AttendanceLog.find(userFilter).sort({ date: -1, createdAt: -1 }).limit(90).lean(),
    DailyReport.find(userFilter).sort({ date: -1, createdAt: -1 }).limit(90).lean(),
    SalesOrder.find(userFilter).sort({ createdAt: -1 }).limit(90).populate('client', 'name contactPerson phone location').lean(),
    ClientVisit.find(userFilter).sort({ visitDate: -1, createdAt: -1 }).limit(90).populate('client', 'name contactPerson phone location').lean(),
    Client.find(clientFilter).sort({ updatedAt: -1, createdAt: -1 }).limit(120).lean(),
    ActivityLog.find({ user: staffUser._id }).sort({ createdAt: -1 }).limit(90).lean(),
  ]);

  const attendance = attendanceEntries.filter((entry) => matchesDateFilter(entry.date, selectedDate));
  const reports = reportEntries.filter((entry) => matchesDateFilter(entry.date, selectedDate));
  const orders = orderEntries.filter((entry) => matchesDateFilter(entry.submittedAt || entry.createdAt, selectedDate));
  const visits = visitEntries.filter((entry) => matchesDateFilter(entry.visitDate, selectedDate));
  const clients = clientEntries.filter((entry) => matchesDateFilter(entry.createdAt, selectedDate));
  const activity = activityEntries.filter((entry) => matchesDateFilter(entry.createdAt, selectedDate));

  return {
    metrics: {
      attendanceCount,
      reportsCount,
      ordersCount,
      pendingOrders,
      visitsCount,
      clientsCount,
      unreadNotifications,
      filteredAttendanceCount: attendance.length,
      filteredReportsCount: reports.length,
      filteredOrdersCount: orders.length,
      filteredVisitsCount: visits.length,
      filteredClientsCount: clients.length,
    },
    latest: {
      attendance: attendanceEntries[0] || null,
      report: reportEntries[0] || null,
      order: orderEntries[0] || null,
      visit: visitEntries[0] || null,
      client: clientEntries[0] || null,
    },
    records: {
      attendance,
      reports,
      orders,
      visits,
      clients,
      activity,
    },
    recentActivity: activity,
  };
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
    const staff = await User.find({ role: 'sales_staff' })
      .select('-hashedPassword -resetPasswordTokenHash -resetPasswordExpiresAt -mfaSecretEncrypted -mfaPendingSecretEncrypted -mfaRecoveryCodeHashes')
      .sort({ name: 1, username: 1 });
    return ok(res, { staff });
  } catch (error) {
    return next(error);
  }
});

router.get('/staff/:id/summary', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid staff id.', 400);
    const staffUser = await User.findOne({ _id: req.params.id, role: 'sales_staff' })
      .select('-hashedPassword -resetPasswordTokenHash -resetPasswordExpiresAt -mfaSecretEncrypted -mfaPendingSecretEncrypted -mfaRecoveryCodeHashes');
    if (!staffUser) return fail(res, 'Staff user not found.', 404);
    const selectedDate = trimText(req.query.date);
    const reportData = await buildStaffReportData(staffUser, selectedDate);

    return ok(res, {
      staff: staffUser,
      today: todayKey(),
      filters: { date: selectedDate || '' },
      metrics: reportData.metrics,
      latest: reportData.latest,
      records: reportData.records,
      recentActivity: reportData.recentActivity,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/staff/:id/report', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return fail(res, 'Invalid staff id.', 400);
    const staffUser = await User.findOne({ _id: req.params.id, role: 'sales_staff' })
      .select('-hashedPassword -resetPasswordTokenHash -resetPasswordExpiresAt -mfaSecretEncrypted -mfaPendingSecretEncrypted -mfaRecoveryCodeHashes');
    if (!staffUser) return fail(res, 'Staff user not found.', 404);
    const selectedDate = trimText(req.query.date);
    const reportData = await buildStaffReportData(staffUser, selectedDate);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LTE Admin Portal';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Section', key: 'section', width: 24 },
      { header: 'Value', key: 'value', width: 40 },
    ];
    summarySheet.addRows([
      { section: 'Name', value: staffUser.name || '-' },
      { section: 'Username', value: staffUser.username || '-' },
      { section: 'Email', value: staffUser.email || '-' },
      { section: 'Phone', value: staffUser.phone || '-' },
      { section: 'Department', value: staffUser.department || '-' },
      { section: 'Active', value: staffUser.isActive ? 'Yes' : 'No' },
      { section: 'Date Filter', value: selectedDate || 'All dates' },
      { section: 'Attendance Entries', value: reportData.metrics.attendanceCount },
      { section: 'Reports', value: reportData.metrics.reportsCount },
      { section: 'Orders', value: reportData.metrics.ordersCount },
      { section: 'Pending Orders', value: reportData.metrics.pendingOrders },
      { section: 'Visits', value: reportData.metrics.visitsCount },
      { section: 'Clients', value: reportData.metrics.clientsCount },
      { section: 'Unread Notifications', value: reportData.metrics.unreadNotifications },
      { section: 'Filtered Attendance', value: reportData.metrics.filteredAttendanceCount },
      { section: 'Filtered Reports', value: reportData.metrics.filteredReportsCount },
      { section: 'Filtered Orders', value: reportData.metrics.filteredOrdersCount },
      { section: 'Filtered Visits', value: reportData.metrics.filteredVisitsCount },
      { section: 'Filtered Clients', value: reportData.metrics.filteredClientsCount },
      { section: 'Last Check In', value: formatDateTime(reportData.latest.attendance?.checkInTime) },
      { section: 'Last Report Date', value: reportData.latest.report?.date || '-' },
      { section: 'Last Order', value: reportData.latest.order?.companyName || reportData.latest.order?.client?.name || reportData.latest.order?.customerName || '-' },
      { section: 'Last Visit', value: reportData.latest.visit?.purpose || reportData.latest.visit?.clientName || '-' },
    ]);

    const attendanceSheet = workbook.addWorksheet('Attendance');
    attendanceSheet.columns = [
      { header: 'Date', key: 'date' },
      { header: 'Check In', key: 'checkIn' },
      { header: 'Check Out', key: 'checkOut' },
      { header: 'Worked Minutes', key: 'workedMinutes' },
      { header: 'Week Start KM', key: 'weekStartKm' },
      { header: 'Week Start Entered At', key: 'weekStartAt' },
      { header: 'Week End KM', key: 'weekEndKm' },
      { header: 'Week End Entered At', key: 'weekEndAt' },
      { header: 'Check In Note', key: 'checkInNote' },
      { header: 'Check Out Note', key: 'checkOutNote' },
    ];
    attendanceSheet.addRows(
      reportData.records.attendance.map((entry) => ({
        date: entry.date || '-',
        checkIn: formatDateTime(entry.checkInTime),
        checkOut: formatDateTime(entry.checkOutTime),
        workedMinutes: entry.totalWorkedMinutes || 0,
        weekStartKm: entry.mileageWeekStart ?? '',
        weekStartAt: formatDateTime(entry.mileageWeekStartAt),
        weekEndKm: entry.mileageWeekEnd ?? '',
        weekEndAt: formatDateTime(entry.mileageWeekEndAt),
        checkInNote: csvCell(entry.checkInNote),
        checkOutNote: csvCell(entry.checkOutNote),
      }))
    );

    const reportsSheet = workbook.addWorksheet('Daily Reports');
    reportsSheet.columns = [
      { header: 'Report Date', key: 'date' },
      { header: 'Created At', key: 'createdAt' },
      { header: 'Summary', key: 'summary' },
      { header: 'Notes', key: 'notes' },
      { header: 'Follow Up Needed', key: 'followUpNeeded' },
      { header: 'Visits In Report', key: 'visits' },
    ];
    reportsSheet.addRows(
      reportData.records.reports.map((entry) => ({
        date: entry.date || '-',
        createdAt: formatDateTime(entry.createdAt),
        summary: csvCell(entry.summary),
        notes: csvCell(entry.notes),
        followUpNeeded: entry.followUpNeeded ? 'Yes' : 'No',
        visits: (entry.visits || []).map((visit) => `${visit.clientName || '-'}: ${csvCell(visit.outcome)}`).join(' | '),
      }))
    );

    const ordersSheet = workbook.addWorksheet('Orders');
    ordersSheet.columns = [
      { header: 'Submitted At', key: 'submittedAt' },
      { header: 'Status', key: 'status' },
      { header: 'Customer', key: 'customer' },
      { header: 'Company', key: 'company' },
      { header: 'Contact Person', key: 'contactPerson' },
      { header: 'Client Record', key: 'client' },
      { header: 'Urgency', key: 'urgency' },
      { header: 'Items', key: 'items' },
      { header: 'Delivery Note', key: 'deliveryNote' },
      { header: 'Notes', key: 'notes' },
    ];
    ordersSheet.addRows(
      reportData.records.orders.map((entry) => ({
        submittedAt: formatDateTime(entry.submittedAt || entry.createdAt),
        status: entry.status || '-',
        customer: entry.customerName || '-',
        company: entry.companyName || '-',
        contactPerson: entry.contactPerson || '-',
        client: entry.client?.name || '-',
        requestedForDate: entry.requestedForDate || '-',
        orderTiming: entry.orderTiming || 'today',
        urgency: entry.urgency || '-',
        items: (entry.items || []).map((item) => formatOrderItem(item)).join(' | '),
        deliveryNote: csvCell(entry.deliveryNote),
        notes: csvCell(entry.notes),
      }))
    );

    const visitsSheet = workbook.addWorksheet('Visits');
    visitsSheet.columns = [
      { header: 'Visit Date', key: 'visitDate' },
      { header: 'Visit Time', key: 'visitTime' },
      { header: 'Created At', key: 'createdAt' },
      { header: 'Client', key: 'client' },
      { header: 'Met Person', key: 'metPerson' },
      { header: 'Location', key: 'location' },
      { header: 'Purpose', key: 'purpose' },
      { header: 'Discussion', key: 'discussion' },
      { header: 'Outcome', key: 'outcome' },
    ];
    visitsSheet.addRows(
      reportData.records.visits.map((entry) => ({
        visitDate: entry.visitDate || '-',
        visitTime: entry.visitTime || '-',
        createdAt: formatDateTime(entry.createdAt),
        client: entry.client?.name || entry.clientName || '-',
        metPerson: entry.metPerson || '-',
        location: entry.location || '-',
        purpose: entry.purpose || '-',
        discussion: csvCell(entry.discussionSummary),
        outcome: csvCell(entry.outcome),
      }))
    );

    const clientsSheet = workbook.addWorksheet('Clients');
    clientsSheet.columns = [
      { header: 'Name', key: 'name' },
      { header: 'Type', key: 'type' },
      { header: 'Department', key: 'department' },
      { header: 'Contact Person', key: 'contactPerson' },
      { header: 'Phone', key: 'phone' },
      { header: 'Email', key: 'email' },
      { header: 'Location', key: 'location' },
      { header: 'Address', key: 'address' },
      { header: 'Created At', key: 'createdAt' },
      { header: 'Updated At', key: 'updatedAt' },
      { header: 'Notes', key: 'notes' },
    ];
    clientsSheet.addRows(
      reportData.records.clients.map((entry) => ({
        name: entry.name || '-',
        type: entry.companyType || '-',
        department: entry.department || '-',
        contactPerson: entry.contactPerson || '-',
        phone: entry.phone || '-',
        email: entry.email || '-',
        location: entry.location || '-',
        address: csvCell(entry.address),
        createdAt: formatDateTime(entry.createdAt),
        updatedAt: formatDateTime(entry.updatedAt),
        notes: csvCell(entry.notes),
      }))
    );

    const activitySheet = workbook.addWorksheet('Activity Log');
    activitySheet.columns = [
      { header: 'Time', key: 'time' },
      { header: 'Module', key: 'module' },
      { header: 'Action', key: 'action' },
      { header: 'Record', key: 'record' },
    ];
    activitySheet.addRows(
      reportData.records.activity.map((entry) => ({
        time: formatDateTime(entry.createdAt),
        module: entry.module || '-',
        action: entry.action || '-',
        record: entry.recordId?.toString?.() || '-',
      }))
    );

    [summarySheet, attendanceSheet, reportsSheet, ordersSheet, visitsSheet, clientsSheet, activitySheet].forEach((sheet) => {
      sheet.getRow(1).font = { bold: true };
      autoFitWorksheet(sheet);
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="staff-report-${staffUser.username || staffUser._id}${selectedDate ? `-${selectedDate}` : ''}.xlsx"`
    );
    return res.send(buffer);
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
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return fail(res, passwordError, 400);
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
      passwordChangedAt: new Date(),
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
    const orders = await SalesOrder.find(applyAdminFilters(req)).sort({ requestedForDate: -1, createdAt: -1 }).populate('user client', 'name username');
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
      message: `Your order for ${order.companyName || order.client?.name || order.customerName} is now ${order.status}.`,
      relatedModule: 'sales_order',
      relatedRecord: order._id,
    });

    await sendStaffPushIfAvailable({
      userId: order.user,
      title: 'Order status updated',
      body: `${order.companyName || order.client?.name || order.customerName} is now ${order.status}.`,
      url: `/staff/order-history?focus=${encodeURIComponent(String(order._id))}`,
      tag: `staff-order-${order._id}`,
      data: { orderId: String(order._id) },
    });

    await logActivity({ user: req.user, action: 'sales_order_updated', module: 'sales_order', recordId: order._id });
    return ok(res, { order }, 'Order updated.');
  } catch (error) {
    return next(error);
  }
});

router.get('/clients', async (req, res, next) => {
  try {
    const filters = {};
    if (req.query.user && isValidObjectId(req.query.user)) {
      filters.$or = [{ assignedTo: req.query.user }, { createdBy: req.query.user }];
    }
    const clients = await Client.find(filters).sort({ updatedAt: -1 }).populate('assignedTo createdBy', 'name username');
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
            mileageWeekStart: row.mileageWeekStart ?? '',
            mileageWeekStartAt: row.mileageWeekStartAt?.toISOString?.() || '',
            mileageWeekEnd: row.mileageWeekEnd ?? '',
            mileageWeekEndAt: row.mileageWeekEndAt?.toISOString?.() || '',
            checkInNote: row.checkInNote || '',
            checkOutNote: row.checkOutNote || '',
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
    await logActivity({
      user: req.user,
      action: 'admin_export_downloaded',
      module: 'export',
      metadata: { resource: req.params.resource, count: rows.length },
    });
    return exportCsv(res, `${req.params.resource}.csv`, rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/full-export', async (req, res, next) => {
  try {
    const workbook = await buildFullExportWorkbook();
    const timestamp = formatDateOnly(new Date()).replace(/-/g, '');
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await logActivity({
      user: req.user,
      action: 'admin_full_export_downloaded',
      module: 'export',
      metadata: { format: 'xlsx' },
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="lte-full-export-${timestamp}.xlsx"`);
    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
});

router.get('/full-recovery-export', async (req, res, next) => {
  try {
    const payload = await buildFullRecoveryExportPayload();
    const timestamp = formatDateOnly(new Date()).replace(/-/g, '');

    await logActivity({
      user: req.user,
      action: 'admin_full_recovery_export_downloaded',
      module: 'export',
      metadata: { format: 'json', collections: payload.collections.length },
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lte-full-recovery-export-${timestamp}.json"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    return next(error);
  }
});

router.get('/messages', async (req, res, next) => {
  try {
    const threads = await MessageThread.find({})
      .sort({ updatedAt: -1 })
      .populate('staffUser', 'name username email phone department')
      .lean();
    return ok(res, {
      threads: threads.map((thread) => ({
        ...mapThreadSummary(thread),
        staffUser: thread.staffUser,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/messages/:staffId', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.staffId)) return fail(res, 'Invalid staff user id.', 400);
    const staffUser = await User.findOne({ _id: req.params.staffId, role: 'sales_staff' })
      .select('name username email phone department isActive')
      .lean();
    if (!staffUser) return fail(res, 'Staff user not found.', 404);

    let thread = await MessageThread.findOne({ staffUser: req.params.staffId });
    if (!thread) {
      thread = await MessageThread.create({ staffUser: req.params.staffId, messages: [] });
    }
    const payload = await mapThreadDetails(thread);
    payload.staffUser = payload.staffUser || staffUser;
    return ok(res, { thread: payload });
  } catch (error) {
    return next(error);
  }
});

router.post('/messages/:staffId', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.staffId)) return fail(res, 'Invalid staff user id.', 400);
    const staffUser = await User.findOne({ _id: req.params.staffId, role: 'sales_staff' });
    if (!staffUser) return fail(res, 'Staff user not found.', 404);

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
      (await MessageThread.findOne({ staffUser: staffUser._id })) ||
      (await MessageThread.create({ staffUser: staffUser._id, messages: [] }));

    thread.messages.push({
      sender: req.user._id,
      senderRole: 'admin',
      text,
      attachments,
      readByAdmin: true,
      readByStaff: false,
    });
    await thread.save();

    await sendUserNotification({
      user: staffUser._id,
      title: 'New office message',
      message: text || `${attachments.length} attachment(s) sent by admin`,
      type: 'info',
      relatedModule: 'messages',
      relatedRecord: thread._id,
    });

    await sendPushToUser({
      user: staffUser,
      title: 'New office message',
      body: text || `${attachments.length} attachment(s) sent by admin`,
      url: '/staff/messages',
      tag: `admin-message-${thread._id}`,
      data: { threadId: String(thread._id), source: 'admin-message' },
    });

    await logActivity({
      user: req.user,
      action: 'message_sent',
      module: 'messages',
      recordId: thread._id,
      metadata: { toStaffUser: staffUser._id, attachmentCount: attachments.length },
    });

    return ok(res, { thread: await mapThreadDetails(thread) }, 'Message sent.', 201);
  } catch (error) {
    return next(error);
  }
});

router.patch('/messages/:staffId/read', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.staffId)) return fail(res, 'Invalid staff user id.', 400);
    const thread = await MessageThread.findOne({ staffUser: req.params.staffId });
    if (!thread) {
      return ok(res, { updated: 0 }, 'No messages to mark as read.');
    }
    let updated = 0;
    thread.messages.forEach((entry) => {
      if (entry.senderRole === 'sales_staff' && !entry.readByAdmin) {
        entry.readByAdmin = true;
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
  console.error('[admin-portal]', error);
  return fail(res, error.message || 'Admin portal request failed.', 500);
});

module.exports = router;
