const mongoose = require('mongoose');

const clientVisitSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    clientName: String,
    visitDate: { type: String, required: true },
    visitTime: String,
    location: String,
    metPerson: String,
    purpose: String,
    discussionSummary: String,
    outcome: String,
    followUpDate: String,
    relatedSchedule: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule' },
  },
  { timestamps: true }
);

clientVisitSchema.index({ user: 1, visitDate: -1 });

module.exports = mongoose.model('ClientVisit', clientVisitSchema);
