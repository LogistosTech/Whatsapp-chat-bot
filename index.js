// server.js
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import mongoose from "mongoose";
import dayjs from "dayjs";

// Models
import Session from "./models/sessionModel.js";
import BookShipment from "./models/bookShipmentModel.js";

// Helpers & Functions
import sendMessage from "./functions/sendMessage.js";
import sendQuickReplies from "./functions/sendQuickReplies.js";
import getMyDetailsAPI from "./APIS/getMyDetailsAPI.js";
import bookShipmentHelper from "./helpers/bookShipmentHelper.js";
import trackOrderHelper from "./helpers/trackOrderHelper.js";
import { signupUser } from "./helpers/signupHelper.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------- MONGODB CONNECTION --------------------
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("📦 MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

app.use(bodyParser.json());

// -------------------- WEBHOOK ROUTE --------------------
app.post("/webhook", async (req, res) => {
  console.log("✅ Webhook hit");

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // -------------------- CASE 1: Message Status --------------------
    const statuses = value?.statuses;
    if (statuses) {
      const status = statuses[0];
      const phone = status.recipient_id;
      const eventType = status.status;
      const error = status?.errors?.[0]?.title;

      console.log(
        eventType === "failed"
          ? `❌ Message to ${phone} failed: ${error}`
          : `📦 Message status to ${phone}: ${eventType}`
      );

      return res.sendStatus(200);
    }

    // -------------------- CASE 2: Incoming Message --------------------
    const messageObj = value?.messages?.[0];
    if (!messageObj) return res.sendStatus(200);

    const messageType = messageObj?.type;
    const interactiveType = messageObj?.interactive?.type || "";
    const buttonReply = messageObj?.interactive?.button_reply?.title;
    const listReply = messageObj?.interactive?.list_reply?.title;
    const listReplyPostback =
      JSON.parse(messageObj?.interactive?.list_reply?.id || "{}").postbackText ||
      "";
    const buttonReplyPostback =
      JSON.parse(
        messageObj?.interactive?.button_reply?.id || "{}"
      ).postbackText || "";

    // Determine final message text
    const msg =
      buttonReplyPostback || listReplyPostback || messageObj?.text?.body || "";

    const phone = value?.contacts?.[0]?.wa_id || messageObj?.from;
    if (!phone || !msg) return res.sendStatus(200);

    console.log(`📥 Received from ${phone}: ${msg}`);

    // -------------------- SESSION HANDLING --------------------
    let session = await Session.findOne({ phone });

    if (!session) {
      // New user → create session and ask signup type
      session = await Session.create({ phone, state: "awaiting_signup_type" });
      await sendQuickReplies(
        phone,
        [
          { title: "Individual", postbackText: "signup_individual" },
          { title: "Organization", postbackText: "signup_organization" },
        ],
        "Welcome! Are you signing up as an individual or organization?",
        "Logistos Bot",
        "Select type"
      );
      return res.sendStatus(200);
    }

    // -------------------- SIGNUP FLOW --------------------
    const msg_lower = msg.toLowerCase();
    if (session.state.startsWith("awaiting_signup")) {
      let signupType =
        session.state === "awaiting_signup_type"
          ? msg_lower
          : session.signup_type;

      // Step 1: Ask signup type
      if (session.state === "awaiting_signup_type") {
        if (["signup_individual", "individual"].includes(msg_lower)) {
          session.signup_type = "individual";
          session.state = "awaiting_signup_details";
          await session.save();
          await sendMessage(
            phone,
            "Please enter your details: First Name, Last Name, Email, Contact Number (comma-separated)."
          );
        } else if (["signup_organization", "organization"].includes(msg_lower)) {
          session.signup_type = "organization";
          session.state = "awaiting_signup_details";
          await session.save();
          await sendMessage(
            phone,
            "Please enter your details: Company Name, Authorized Signatory, First Name, Last Name, Email, Contact, GST No, PAN No (comma-separated)."
          );
        } else {
          await sendMessage(phone, "⚠️ Please choose *Individual* or *Organization*.");
        }
        return res.sendStatus(200);
      }

      // Step 2: Capture signup details
      if (session.state === "awaiting_signup_details") {
        const details = msg.split(",").map((s) => s.trim());
        let payload = {};

        if (signupType === "individual") {
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
          session.state = "signup_completed";
          await session.save();
          await sendMessage(
            phone,
            `✅ Signup successful! Your ID: ${signupRes?.id || "N/A"}\nYou can now login with your email and password.`
          );
        } catch (err) {
          console.error("❌ Signup failed:", err.message);
          await sendMessage(phone, "❌ Signup failed. Please try again later.");
        }
        return res.sendStatus(200);
      }
    }

    // -------------------- AUTHENTICATION FLOW --------------------
    if (session.state === "awaiting_email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(msg.trim())) {
        await sendMessage(phone, "⚠️ Please enter a valid *email address*.");
        return res.sendStatus(200);
      }
      session.email = msg.trim();
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

        await getMyDetailsAPI(phone); // fetch user info

        await sendQuickReplies(
          phone,
          [
            { title: "Book a Shipment", postbackText: "book" },
            { title: "Track an Order", postbackText: "track" },
            { title: "Logout", postbackText: "logout" },
          ],
          "✅ Login successful!\n\nWhat would you like to do?",
          "Logistos Bot",
          "Choose an option below"
        );
      } catch (err) {
        console.error("❌ Login failed:", err.message);
        session.state = "awaiting_email";
        await session.save();
        await sendMessage(phone, "❌ Login failed. Please type your *email* again.");
      }
      return res.sendStatus(200);
    }

    // -------------------- AUTHENTICATED USER FLOW --------------------
    if (session.state === "authenticated") {
      const sessionAgeHours = dayjs().diff(dayjs(session.createdAt), "hour");

      // Session expiration handling
      if (sessionAgeHours >= 48) {
        await Session.deleteOne({ phone });
        await BookShipment.deleteOne({ phone });
        await sendMessage(
          phone,
          '⚠️ Your session expired. Please login again.\n\nType "hi" to start.'
        );
        return res.sendStatus(200);
      }

      // Process user commands
      if (msg_lower === "hi") {
        await sendQuickReplies(
          phone,
          [
            { title: "Book a Shipment", postbackText: "book" },
            { title: "Track an Order", postbackText: "track" },
            { title: "Logout", postbackText: "logout" },
          ],
          "✅ You are logged in.\n\nWhat would you like to do?",
          "Logistos Bot",
          "Choose an option below"
        );
      } else if (msg_lower === "book" || session.operation === "booking") {
        await bookShipmentHelper(phone, session, msg, interactiveType);
      } else if (msg_lower === "track" || session.operation === "tracking") {
        await trackOrderHelper(phone, msg);
      } else if (msg_lower === "logout") {
        await Session.deleteOne({ phone });
        await BookShipment.deleteOne({ phone });
        await sendMessage(phone, '✅ You have been logged out. Type "hi" to log in again.');
      } else {
        await sendMessage(phone, "*Invalid Prompt!* Type *Hi* to start again.");
      }
      return res.sendStatus(200);
    }

    // Default fallback
    return res.status(200).json({
      message: {
        type: "text",
        text: "Sorry, I didn't understand that. Please type 'hi' to start again.",
      },
      type: "RESPONSE",
    });
  } catch (err) {
    console.error("❌ Webhook processing error:", err.message);
    return res.sendStatus(500);
  }
});

// -------------------- START SERVER --------------------
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot running at http://localhost:${PORT}/webhook`);
});
