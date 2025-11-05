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

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("📦 MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

app.use(bodyParser.json());

// ================================
// Helper: Reset session
// ================================
const resetSession = async (phone) => {
  await Session.deleteOne({ phone });
  await BookShipment.deleteMany({ phone });
};

// ================================
// Webhook
// ================================
app.post("/webhook", async (req, res) => {
  console.log("✅ Webhook hit");

  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  // -----------------------------
  // Handle Message Status
  // -----------------------------
  if (value?.statuses) {
    const status = value.statuses[0];
    const phone = status.recipient_id;
    console.log(`📦 Message status to ${phone}: ${status.status}`);
    return res.sendStatus(200);
  }

  // -----------------------------
  // Incoming Message
  // -----------------------------
  const messageObj = value?.messages?.[0];
  if (!messageObj) return res.sendStatus(200);

  const phone = value?.contacts?.[0]?.wa_id || messageObj?.from;
  const interactiveType = messageObj?.interactive?.type || "";
  const buttonReplyPostback =
    JSON.parse(messageObj?.interactive?.button_reply?.id || "{}").postbackText || "";
  const listReplyPostback =
    JSON.parse(messageObj?.interactive?.list_reply?.id || "{}").postbackText || "";

  const msg = (buttonReplyPostback || listReplyPostback || messageObj?.text?.body || "").trim();
  const msg_lower = msg.toLowerCase();

  console.log(`📥 Received from ${phone}: ${msg}`);

  if (!phone || !msg) return res.sendStatus(200);

  // -----------------------------
  // Load or Create Session
  // -----------------------------
  let session = await Session.findOne({ phone });
  if (!session) {
    session = await Session.create({ phone, state: "start" });
  }

  // -----------------------------
  // SESSION STATES
  // -----------------------------

  // START: Greet user and ask Login / Signup
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

  // LOGIN OR SIGNUP CHOICE
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

  // -----------------------------
  // SIGNUP FLOW
  // -----------------------------
  if (session.state.startsWith("awaiting_signup")) {
    // Step 1: Ask for type
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
        await sendMessage(phone, "Please enter: Company Name, Authorized Signatory, First Name, Last Name, Email, Contact, GST No, PAN No (comma-separated).");
      }
      return res.sendStatus(200);
    }

    // Step 2: Collect details
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

  // -----------------------------
  // LOGIN FLOW
  // -----------------------------
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

      session.token = loginRes.data.access;
      session.state = "authenticated";
      await session.save();

      await getMyDetailsAPI(phone);

      await sendQuickReplies(
        phone,
        [
          { title: "Book a Shipment", postbackText: "book" },
          { title: "Track an Order", postbackText: "track" },
          { title: "Create Ticket", postbackText: "ticket" },
          { title: "Logout", postbackText: "logout" },
        ],
        "✅ Login successful!\nWhat would you like to do?",
        "Logistos Bot",
        "Choose an option"
      );
    } catch (err) {
      console.error("❌ Login failed:", err.message);
      session.state = "awaiting_email";
      await session.save();
      await sendMessage(phone, "❌ Login failed. Please enter your *email* again.");
    }
    return res.sendStatus(200);
  }

  // -----------------------------
  // AUTHENTICATED USER
  // -----------------------------
  if (session.state === "authenticated") {
    const sessionAgeHours = dayjs().diff(dayjs(session.createdAt), "hour");

    if (sessionAgeHours >= 48) {
      await resetSession(phone);
      await sendMessage(phone, '⚠️ Session expired. Type "hi" to login again.');
      return res.sendStatus(200);
    }

    // Commands
    if (msg_lower === "book" || session.operation === "booking") {
      try {
        await bookShipmentHelper(phone, session, msg, interactiveType);
      } catch (err) {
        console.error("❌ Booking error:", err.message);
        await sendMessage(phone, "⚠️ Failed to start booking. Try again.");
      }
    } else if (msg_lower === "track" || session.operation === "tracking") {
      await trackOrderHelper(phone, msg);
    } else if (msg_lower === "logout") {
      await resetSession(phone);
      await sendMessage(phone, '✅ You have been logged out. Type "hi" to login again.');
    } else if (msg_lower === "ticket" || session.operation === "ticketing") {
      if (msg_lower === "ticket" && session.operation !== "ticketing") {
        return startTicketFlow(phone, session);
      } else {
        await ticketCreateHelper(phone, msg);
      }
    } else {
      await sendQuickReplies(
        phone,
        [
          { title: "Book a Shipment", postbackText: "book" },
          { title: "Track an Order", postbackText: "track" },
          { title: "Logout", postbackText: "logout" },
        ],
        "✅ You are already logged in. Choose an option:",
        "Logistos Bot",
        "Select"
      );
    }

    return res.sendStatus(200);

    // -----------------------------
    // Fallback
    // -----------------------------
    await sendMessage(phone, "⚠️ Sorry, I didn't understand. Type 'hi' to restart.");
    return res.sendStatus(200);


    // ================================
    // Start Server
    // ================================
    app.listen(PORT, () => {
      console.log(`🚀 WhatsApp bot running at http://localhost:${PORT}/webhook`);
    });
