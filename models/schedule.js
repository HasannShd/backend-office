const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: String,
    assignedDate: { type: String, required: true },
    startTime: String,
    endTime: String,
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    clientLabel: String,
    location: String,
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'cancelled', 'missed'],
      default: 'pending',
    },
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

scheduleSchema.index({ user: 1, assignedDate: 1, status: 1 });

module.exports = mongoose.model('Schedule', scheduleSchema);
