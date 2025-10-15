import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    email: String,
    token: String,
    clientId: Number, 
    state: String, 
    operation: {
      type: String,
      enum: ['booking', 'tracking', null],
      default: null
    },
    trackingStatus:{
      type:String,
      enum: ['init','in_progress', 'completed'],
      default: 'init'
    }
  },
  { timestamps: true }
);

// TTL: expire after 5 minutes *if state is not authenticated*
sessionSchema.index(
  { updatedAt: 1 },
  {
    expireAfterSeconds: 300, // 5 minutes
    partialFilterExpression: { state: { $ne: "authenticated" } }
  }
);

// TTL: additionally expire after 24h for any session as a fallback
sessionSchema.index(
  { updatedAt: 1 },
  {
    expireAfterSeconds: 86400 // 24 hours
  }
);

export default mongoose.model('Session', sessionSchema);
