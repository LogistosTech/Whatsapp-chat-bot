// models/sessionModel.js
import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    email: String,
    token: String,
    clientId: Number,
    state: String,
    lastMsgId: String,
    
    // add 'ratecalc' here
    operation: {
      type: String,
      enum: ['booking', 'tracking', 'ticketing', 'ratecalc', null],
      default: null
    },

    // tracking (already there)
    trackingStatus: {
      type: String,
      enum: ['init', 'in_progress', 'completed'],
      default: 'init'
    },

    // 🔹 Rate calculator conversation state
    rateStatus: {
      type: String,
      enum: [
        'init',
        'pickup_pin',
        'drop_pin',
        'courier_type',
        'mode',
        'units',
        'weight',
        'dimension',
        'dims',
        'invoice',
        'paytype',
        'payamount',
        'confirm',
        'fetching',
        'done'
      ],
      default: 'init'
    },

    // 🔹 Temp draft while collecting inputs
    rateDraft: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

// TTLs unchanged…
sessionSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 300, partialFilterExpression: { state: { $ne: "authenticated" } } }
);
sessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400 });

export default mongoose.model('Session', sessionSchema);
