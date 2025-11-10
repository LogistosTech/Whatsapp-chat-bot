import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import mongoose from "mongoose";
import dayjs from "dayjs";

import Session from "./models/sessionModel.js";
import BookShipment from "./models/bookShipmentModel.js";
import sendMessage from "./functions/sendMessage.js";
import sendQuickReplies from "./functions/sendQuickReplies.js";
import bookShipmentHelper from "./helpers/bookShipmentHelper.js";
import trackOrderHelper from "./helpers/trackOrderHelper.js";
import getMyDetailsAPI from "./APIS/getMyDetailsAPI.js";
import { signupUser } from "./helpers/signupHelper.js";
import ticketCreateHelper, { startTicketFlow } from "./helpers/ticketCreateHelper.js";
import sendListMessage from "./functions/sendListMessage.js";
import rateCalcHelper,  { startRateFlow } from "./helpers/rateCalcHelper.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,        // ok
    useUnifiedTopology: true,     // ok
  })
  .then(() => console.log("📦 MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ----------------------------- */
/* Helpers                       */
/* ----------------------------- */
const resetSession = async (phone) => {
  await Session.deleteOne({ phone });
  await BookShipment.deleteMany({ phone });
};

// Safe JSON parser for interactive IDs (can be plain strings)
const tryParseJSON = (val) => {
  if (typeof val !== "string") return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
};

// Extract final message text (buttons / lists / plain)
const extractIncomingMessage = (messageObj) => {
  const interactive = messageObj?.interactive;
  if (!interactive) {
    return { text: (messageObj?.text?.body || "").trim(), interactiveType: "" };
  }

  const type = interactive?.type || "";
  if (type === "button_reply") {
    const idRaw = interactive?.button_reply?.id; // might be "book" or a JSON string
    const parsed = tryParseJSON(idRaw);
    const postbackText = parsed?.postbackText || idRaw || "";
    return { text: String(postbackText).trim(), interactiveType: "button_reply" };
  }

  if (type === "list_reply") {
    const idRaw = interactive?.list_reply?.id;
    const parsed = tryParseJSON(idRaw);
    const postbackText = parsed?.postbackText || idRaw || "";
    return { text: String(postbackText).trim(), interactiveType: "list_reply" };
  }

  return { text: (messageObj?.text?.body || "").trim(), interactiveType: type };
};

// Health endpoint (useful for Render)
app.get("/", (req, res) => res.send("OK"));

/* ----------------------------- */
/* Webhook                       */
/* ----------------------------- */
app.post("/webhook", async (req, res) => {
  try {
    console.log("✅ Webhook hit");

    // Detect provider shape: Meta vs Gupshup
    const isMeta = !!req.body?.entry?.[0]?.changes?.[0]?.value;
    let phone = "";
    let text = "";
    let interactiveType = "";
    let incomingId = "";

    if (isMeta) {
      // Meta (WhatsApp Cloud) payload
      const value = req.body.entry[0].changes[0].value;

      // Delivery statuses
      if (Array.isArray(value.statuses) && value.statuses.length > 0) {
        const status = value.statuses[0];
        const sPhone = status?.recipient_id;
        console.log(`📦 Message status to ${sPhone}: ${status?.status}`);
        return res.sendStatus(200);
      }

      // Inbound message
      const messageObj = value?.messages?.[0];
      if (!messageObj) return res.sendStatus(200);

      phone = value?.contacts?.[0]?.wa_id || messageObj?.from || "";

      const extracted = extractIncomingMessage(messageObj);
      text = extracted.text;
      interactiveType = extracted.interactiveType;

      incomingId = messageObj?.id || messageObj?.key?.id || "";
    } else {
      // Gupshup payload (often form-encoded with a 'payload' JSON string)
      const raw = req.body?.payload ? req.body.payload : req.body;
      const body = typeof raw === "string" ? JSON.parse(raw) : raw || {};

      // Delivery/status events
      if (body?.type === "message-event" || body?.type === "message-status") {
        const sPhone = body?.payload?.destination || body?.payload?.phone || body?.phone;
        const sStatus = body?.payload?.type || body?.payload?.status;
        console.log(`📦 Message status to ${sPhone}: ${sStatus}`);
        return res.sendStatus(200);
      }

      // Inbound message
      phone = body?.sender?.phone || body?.payload?.source || "";
      incomingId = body?.messageId || body?.payload?.id || body?.payload?.payloadId || "";

      const p = body?.payload || {};
      const pType = (p?.type || "").toLowerCase();
      interactiveType = pType;

      if (pType === "text") {
        text = (p?.payload?.text || p?.text || "").trim();
      } else if (pType === "button") {
        text = (p?.payload?.payload || p?.payload?.title || "").trim();
      } else if (pType === "list_reply" || pType === "list") {
        text = (p?.payload?.id || p?.payload?.title || "").trim();
      } else {
        text = (p?.text || p?.payload?.text || "").trim();
      }
    }

    if (!phone) return res.sendStatus(200);

    const msg = (text || "").trim();
    const msg_lower = msg.toLowerCase();

    console.log(`📥 Received from ${phone}: ${msg}`);

    // Load or create session
    let session = await Session.findOne({ phone });
    if (!session) {
      session = await Session.create({ phone, state: "start" });
    }

    // Deduplicate by provider message id
    if (incomingId && session.lastMsgId === incomingId) {
      console.log("↩️ Duplicate message ID, skipping");
      return res.sendStatus(200);
    }
    if (incomingId) {
      session.lastMsgId = incomingId;
      await session.save();
    }

    // Welcome
    if (session.state === "start" || msg_lower === "hi") {
      session.state = "awaiting_login_or_signup";
      await session.save();

      await sendQuickReplies(
        phone,
        [
          { title: "Login", postbackText: "login" },
          { title: "Signup", postbackText: "signup" }
        ],
        "👋 Welcome to Logistos Bot! Do you want to *Login* or *Signup*?",
        "Logistos Bot",
        "Choose an option"
      );
      return res.sendStatus(200);
    }

    // Signup branch
    if (session.state.startsWith("awaiting_signup")) {
      if (session.state === "awaiting_signup_type") {
        if (["signup_individual", "individual"].includes(msg_lower)) {
          session.signup_type = "individual";
        } else if (["signup_organization", "organization"].includes(msg_lower)) {
          session.signup_type = "organization";
        } else if (msg_lower === "login") {
          session.state = "awaiting_email";
          await session.save();
          await sendMessage(phone, "Redirecting to login. Please enter your *email*.");
          return res.sendStatus(200);
        } else {
          await sendMessage(phone, "⚠️ Please choose a valid option.");
          return res.sendStatus(200);
        }

        session.state = "awaiting_signup_details";
        await session.save();

        if (session.signup_type === "individual") {
          await sendMessage(phone, "Please enter: First Name, Last Name, Email, Contact Number");
        } else {
          await sendMessage(phone, "Please enter: Company Name, Signatory, First Name, Last Name, Email, Contact, GST, PAN");
        }
        return res.sendStatus(200);
      }

      if (session.state === "awaiting_signup_details") {
        const details = msg.split(",").map(s => s.trim());
        let payload = {};

        if (session.signup_type === "individual") {
          payload = {
            user_first_name: details[0],
            user_last_name: details[1] || "",
            user_email: details[2],
            client_contact_number: details[3],
            user_type: "individual"
          };
        } else {
          payload = {
            client_name: details[0],
            authorised_signatory_name: details[1],
            user_first_name: details[2],
            user_last_name: details[3],
            user_email: details[4],
            client_contact_number: details[5],
            gst_no: details[6],
            pan_no: details[7],
            user_type: "organization"
          };
        }

        try {
          const signupRes = await signupUser(payload);
          session.state = "awaiting_email";
          await session.save();

          await sendMessage(
            phone,
            `✅ Signup successful! Your ID: ${signupRes?.id || "N/A"}\nPlease login now.`
          );
        } catch {
          await sendMessage(phone, "❌ Signup failed. Try again later.");
        }
        return res.sendStatus(200);
      }
    }

    // Login branch
    if (session.state === "awaiting_login_or_signup") {
      if (msg_lower === "signup") {
        session.state = "awaiting_signup_type";
        await session.save();

        await sendQuickReplies(
          phone,
          [
            { title: "Individual", postbackText: "signup_individual" },
            { title: "Organization", postbackText: "signup_organization" },
            { title: "Back to Login", postbackText: "login" }
          ],
          "Please select your type:",
          "Logistos Bot",
          "Choose type"
        );
        return res.sendStatus(200);
      }

      if (msg_lower === "login") {
        session.state = "awaiting_email";
        await session.save();
        await sendMessage(phone, "Please enter your *email* to login.");
        return res.sendStatus(200);
      }

      await sendMessage(phone, "⚠️ Please choose *Login* or *Signup*.");
      return res.sendStatus(200);
    }

    if (session.state === "awaiting_email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(msg)) {
        await sendMessage(phone, "⚠️ Enter a valid *email*.");
        return res.sendStatus(200);
      }

      session.email = msg;
      session.state = "awaiting_password";
      await session.save();

      await sendMessage(phone, "Enter your *password*.");
      return res.sendStatus(200);
    }

    if (session.state === "awaiting_password") {
      try {
        const loginRes = await axios.post(
          "https://admin.logistos.in/seller/users/login/",
          { email: session.email, password: msg },
          { headers: { "Content-Type": "application/json" } }
        );

        session.token = loginRes.data.access;
        session.state = "authenticated";
        session.expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
        await session.save();

        await getMyDetailsAPI(phone);

        await sendListMessage(
          phone,
          [
            { title: "Rate Calculator", postbackText: "rate" },
            { title: "Track an Order", postbackText: "track" },
            { title: "Create Ticket", postbackText: "ticket" },
            { title: "Logout", postbackText: "logout" }
          ],
          "✅ You are logged in. Choose an option:",
          "Logistos Bot",
          "Select",
          "Open menu"
        );
      } catch {
        session.state = "awaiting_email";
        await session.save();
        await sendMessage(phone, "❌ Login failed. Enter email again.");
      }
      return res.sendStatus(200);
    }

    // Authenticated menu + flows
    if (session.state === "authenticated") {
      const referenceTs = session.updatedAt || session.createdAt || new Date();
      const sessionAgeHours = dayjs().diff(dayjs(referenceTs), "hour");

      if (sessionAgeHours >= 48) {
        await Session.deleteOne({ phone });
        await BookShipment.deleteMany({ phone });
        await sendMessage(phone, "⚠️ Session expired. Type 'hi' to login again.");
        return res.sendStatus(200);
      }

      if (msg_lower === "book" || session.operation === "booking") {
        await bookShipmentHelper(phone, session, msg, interactiveType);
        return res.sendStatus(200);
      }

      if (msg_lower === "track" || session.operation === "tracking") {
        await trackOrderHelper(phone, msg);
        return res.sendStatus(200);
      }

      if (msg_lower === "logout") {
        await Session.deleteOne({ phone });
        await BookShipment.deleteMany({ phone });
        await sendMessage(phone, "✅ Logged out. Type 'hi' to login.");
        return res.sendStatus(200);
      }

      if (msg_lower === "ticket" || session.operation === "ticketing") {
        if (msg_lower === "ticket" && session.operation !== "ticketing") {
          await startTicketFlow(phone, session);
        } else {
          await ticketCreateHelper(phone, msg);
        }
        return res.sendStatus(200);
      }

      if (msg_lower === "rate" && session.operation !== "ratecalc") {
        await startRateFlow(phone, session);
        return res.sendStatus(200);
      }

      if (session.operation === "ratecalc") {
        await rateCalcHelper(phone, msg);
        return res.sendStatus(200);
      }

      await sendQuickReplies(
        phone,
        [
          { title: "Rate Calculator", postbackText: "rate" },
          { title: "Track an Order", postbackText: "track" },
          { title: "Create Ticket", postbackText: "ticket" },
          { title: "Logout", postbackText: "logout" }
        ],
        "✅ You are logged in. Choose an option:",
        "Logistos Bot",
        "Select"
      );
      return res.sendStatus(200);
    }

    await sendMessage(phone, "⚠️ Sorry, I didn't understand. Type 'hi' to restart.");
    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    return res.sendStatus(200);
  }
});


/* ----------------------------- */
/* Start Server                  */
/* ----------------------------- */
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot running on port ${PORT}`);
});
