const mongoose = require('mongoose');

const reportVisitSchema = new mongoose.Schema(
  {
    clientName: String,
    outcome: String,
  },
  { _id: false }
);

const dailyReportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    summary: { type: String, required: true },
    visits: [reportVisitSchema],
    followUpNeeded: { type: Boolean, default: false },
    notes: String,
    relatedSchedule: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule' },
  },
  { timestamps: true }
);

dailyReportSchema.index({ user: 1, date: -1 });

module.exports = mongoose.model('DailyReport', dailyReportSchema);
