// models/sessionModel.js
import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    email: String,
    token: String,

    // required by ticket creation
    client_id: Number,

    state: { type: String, default: 'start' },

    operation: {
      type: String,
      enum: ['booking', 'tracking', 'ticketing', null],   // ← include 'ticketing'
      default: null
    },

    // tracking flow (existing)
    trackingStatus: {
      type: String,
      enum: ['init', 'in_progress', 'completed'],
      default: 'init'
    },

    // ticket flow (MUST include every state you set in code)
    ticketStatus: {
      type: String,
      enum: [
        'choose_type',
        'choose_subtype',
        'need_shipment',
        'need_awb',
        'need_details',
        'done',
        null
      ],
      default: null
    },

    // temporary stash for ticket creation
    ticketDraft: {
      type: new mongoose.Schema({
        type_key: String,
        subtype_key: String,
        shipment_id: String,
        awb: String,
        note: String,
      }, { _id: false }),
      default: {},
    },

    // optional signup helper
    signup_type: { type: String, enum: ['individual', 'organization', null], default: null },
  },
  { timestamps: true }
);

// IMPORTANT: support hot-reload / re-deploy without model overwrite errors
export default mongoose.models.Session || mongoose.model('Session', sessionSchema);
