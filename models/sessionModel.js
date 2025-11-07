// models/sessionModel.js
import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    email: String,
    token: String,

    // Normalize naming used elsewhere
    client_id: Number, // (was clientId) keep what you actually use; align your code

    // High-level state machine
    state: { type: String, default: 'start' }, // start | awaiting_login_or_signup | awaiting_email | ...

    // Operation within authenticated context
    operation: {
      type: String,
      enum: ['booking', 'tracking', 'ticketing', null],
      default: null,
    },

    // Tracking sub-state (your existing flow)
    trackingStatus: {
      type: String,
      enum: ['init', 'in_progress', 'completed'],
      default: 'init',
    },

    // Ticket creation sub-state (used by ticketing flow)
    ticketStatus: {
      type: String,
      enum: ['choose_subtype', 'need_shipment', 'need_code', 'need_details', 'done', null],
      default: null,
    },

    // Temporary stash for ticket flow
    ticketDraft: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Optional: login helper fields you referenced
    signup_type: { type: String, enum: ['individual', 'organization', null], default: null },

    // Optional: per-doc TTL control (see below)
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ✅ Single TTL index using a dedicated field.
//    You control TTL by setting `expiresAt` in code.
//    Example: unauthenticated -> now+5m, authenticated -> now+48h.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('Session', sessionSchema);
