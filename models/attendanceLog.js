const mongoose = require('mongoose');

const attendanceLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    checkInTime: Date,
    checkOutTime: Date,
    checkInNote: String,
    checkOutNote: String,
    mileageWeekStart: Number,
    mileageWeekStartAt: Date,
    mileageWeekEnd: Number,
    mileageWeekEndAt: Date,
    totalWorkedMinutes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

attendanceLogSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);
