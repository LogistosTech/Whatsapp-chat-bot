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
import rateCalcHelper, { startRateFlow } from "./helpers/rateCalcHelper.js";

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

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value) {
      console.warn("⚠️ No value in payload");
      return res.sendStatus(200);
    }

    // Status callbacks
    if (Array.isArray(value.statuses) && value.statuses.length > 0) {
      const status = value.statuses[0];
      const phone = status?.recipient_id;
      console.log(`📦 Message status to ${phone}: ${status?.status}`);
      return res.sendStatus(200);
    }

    // Messages
    const messageObj = value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const phone = value?.contacts?.[0]?.wa_id || messageObj?.from;
    if (!phone) return res.sendStatus(200);

    const { text: msg, interactiveType } = extractIncomingMessage(messageObj);
    const msg_lower = (msg || "").toLowerCase();

    console.log(`📥 Received from ${phone}: ${msg}`);

    // Deduplicate re-deliveries
    const incomingId = messageObj?.id || messageObj?.key?.id || "";

    // Load or create session
    let session = await Session.findOne({ phone });
    if (!session) {
      session = await Session.create({ phone, state: "start" });
    }

    // If same WA message ID already processed, just ACK to stop retries
    if (incomingId && session.lastMsgId === incomingId) {
      console.log("↩️  Duplicate message detected, skipping:", incomingId);
      return res.sendStatus(200);
    }
    // Save it right away so retries won’t re-run logic
    if (incomingId) {
      session.lastMsgId = incomingId;
      await session.save();
    }

    /* -----------------------------
       START: Welcome
    ----------------------------- */
    if (session.state === "start" || msg_lower === "hi") {
      session.state = "awaiting_login_or_signup";
      await session.save();

      await sendQuickReplies(
        phone,
        [
          { title: "Login", postbackText: "login" },
          { title: "Signup", postbackText: "signup" },
        ],
        "👋 Welcome to Logistos Bot! Do you want to *Login* or *Signup*?",
        "Logistos Bot",
        "Choose an option"
      );
      return res.sendStatus(200);
    }

    /* -----------------------------
       LOGIN OR SIGNUP CHOICE
    ----------------------------- */
    if (session.state === "awaiting_login_or_signup") {
      if (msg_lower === "signup") {
        session.state = "awaiting_signup_type";
        await session.save();

        await sendQuickReplies(
          phone,
          [
            { title: "Individual", postbackText: "signup_individual" },
            { title: "Organization", postbackText: "signup_organization" },
            { title: "Back to Login", postbackText: "login" },
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

    /* -----------------------------
       SIGNUP FLOW
    ----------------------------- */
    if (session.state.startsWith("awaiting_signup")) {
      // Step 1: type
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
          await sendMessage(phone, "⚠️ Please choose *Individual*, *Organization*, or *Back to Login*.");
          return res.sendStatus(200);
        }

        session.state = "awaiting_signup_details";
        await session.save();

        if (session.signup_type === "individual") {
          await sendMessage(phone, "Please enter: First Name, Last Name, Email, Contact Number (comma-separated).");
        } else {
          await sendMessage(
            phone,
            "Please enter: Company Name, Authorized Signatory, First Name, Last Name, Email, Contact, GST No, PAN No (comma-separated)."
          );
        }
        return res.sendStatus(200);
      }

      // Step 2: details
      if (session.state === "awaiting_signup_details") {
        const details = msg.split(",").map((s) => s.trim());
        let payload = {};

        if (session.signup_type === "individual") {
          payload = {
            user_first_name: details[0],
            user_last_name: details[1] || "",
            user_email: details[2],
            client_contact_number: details[3],
            user_type: "individual",
          };
        } else {
          payload = {
            client_name: details[0],
            authorised_signatory_name: details[1],
            user_first_name: details[2],
            user_last_name: details[3] || "",
            user_email: details[4],
            client_contact_number: details[5],
            gst_no: details[6],
            pan_no: details[7],
            user_type: "organization",
          };
        }

        try {
          const signupRes = await signupUser(payload);
          session.state = "awaiting_email";
          await session.save();

          await sendMessage(
            phone,
            `✅ Signup successful! Your ID: ${signupRes?.id || "N/A"}\nPlease login now with your email and password.`
          );
        } catch (err) {
          console.error("❌ Signup failed:", err.message);
          await sendMessage(phone, "❌ Signup failed. Try again later or type 'hi' to restart.");
        }
        return res.sendStatus(200);
      }
    }

    /* -----------------------------
       LOGIN FLOW
    ----------------------------- */
    if (session.state === "awaiting_email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(msg)) {
        await sendMessage(phone, "⚠️ Please enter a valid *email address*.");
        return res.sendStatus(200);
      }
      session.email = msg;
      session.state = "awaiting_password";
      await session.save();
      await sendMessage(phone, "Got it. Now enter your *password*.");
      return res.sendStatus(200);
    }

    if (session.state === "awaiting_password") {
      try {
        const loginRes = await axios.post(
          "https://admin.logistos.in/seller/users/login/",
          { email: session.email, password: msg },
          { headers: { "Content-Type": "application/json" } }
        );

        // after successful login
        session.token = loginRes.data.access;
        session.state = 'authenticated';
        session.expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
        await session.save();

        await getMyDetailsAPI(phone);

        await sendListMessage(
          phone,
          [
            // { title: "Book a Shipment", postbackText: "book" },
            { title: "Track an Order", postbackText: "track" },
            { title: "Rate Calculator", postbackText: "rate" },
            { title: "Create Ticket", postbackText: "ticket" },
            { title: "Logout", postbackText: "logout" },
          ],
          "✅ You are already logged in. Choose an option:",
          "Logistos Bot",
          "Select",
          "Open menu"
        );
      } catch (err) {
        console.error("❌ Login failed:", err.message);
        session.state = "awaiting_email";
        await session.save();
        await sendMessage(phone, "❌ Login failed. Please enter your *email* again.");
      }
      return res.sendStatus(200);
    }

    /* -----------------------------
       AUTHENTICATED USER
    ----------------------------- */
    if (session.state === "authenticated") {
      // safer age check
      const referenceTs = session.updatedAt || session.createdAt || new Date();
      const sessionAgeHours = dayjs().diff(dayjs(referenceTs), "hour");

      if (sessionAgeHours >= 48) {
        await resetSession(phone);
        await sendMessage(phone, '⚠️ Session expired. Type "hi" to login again.');
        return res.sendStatus(200);
      }

      if (msg_lower === "book" || session.operation === "booking") {
        try {
          await bookShipmentHelper(phone, session, msg, interactiveType);
        } catch (err) {
          console.error("❌ Booking error:", err.message);
          await sendMessage(phone, "⚠️ Failed to start booking. Try again.");
        }
        return res.sendStatus(200);
      }

      if (msg_lower === "track" || session.operation === "tracking") {
        await trackOrderHelper(phone, msg);
        return res.sendStatus(200);
      }

      if (msg_lower === "logout") {
        await resetSession(phone);
        await sendMessage(phone, '✅ You have been logged out. Type "hi" to login again.');
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

      try {
        if (msg_lower === "rate" && session.operation !== "ratecalc") {
          await startRateFlow(phone, session);
        } else {
          await rateCalcHelper(phone, msg);
        }
      } catch (err) {
        console.error("❌ Rate flow error:", err?.response?.data || err.message);
      }
      return res.sendStatus(200);

      // default authenticated menu
      await sendQuickReplies(
        phone,
        [
          // { title: "Book a Shipment", postbackText: "book" },
          { title: "Rate Calculator", postbackText: "rate" },
          { title: "Track an Order", postbackText: "track" },
          { title: "Create Ticket", postbackText: "ticket" },
          { title: "Logout", postbackText: "logout" },
        ],
        "✅ You are already logged in. Choose an option:",
        "Logistos Bot",
        "Select"
      );
      return res.sendStatus(200);
    }

    // Fallback for any other state
    await sendMessage(phone, "⚠️ Sorry, I didn't understand. Type 'hi' to restart.");
    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err?.message || err);
    return res.sendStatus(200);
  }
});

/* ----------------------------- */
/* Start Server                  */
/* ----------------------------- */
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot running on port ${PORT}`);
});
