import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import mongoose from "mongoose";
import dayjs from "dayjs";
import Session from "./models/sessionModel.js";
import BookShipment from "./models/bookShipmentModel.js";
import sendMessage from "./functions/sendMessage.js";
import bookShipmentHelper from "./helpers/bookShipmentHelper.js";
import sendQuickReplies from "./functions/sendQuickReplies.js";
import getMyDetailsAPI from "./APIS/getMyDetailsAPI.js";
import trackOrderHelper from "./helpers/trackOrderHelper.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("📦 MongoDB connected");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });

app.use(bodyParser.json());

app.post("/webhook", async (req, res) => {
  console.log("✅ Webhook hit");
  //console.log("📨 Incoming payload:", JSON.stringify(req.body, null, 2));

  // Support Meta-style payload (entry.changes[].value.messages[])
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  // 🟡 CASE 1: Message Status Events (delivery reports, failures, etc.)
  const statuses = value?.statuses;
  if (statuses) {
    const status = statuses[0];
    const phone = status.recipient_id;
    const eventType = status.status;
    const error = status?.errors?.[0]?.title;

    if (eventType === "failed") {
      console.error(`❌ Message to ${phone} failed: ${error}`);
    } else {
      console.log(`📦 Message status to ${phone}: ${eventType}`);
    }

    return res.sendStatus(200);
  }

  // 🟢 CASE 2: Incoming User Message
  const messageObj = value?.messages?.[0];
  const messageType = messageObj?.type;

  console.log('🔍 Message Incoming:', messageObj);
  

  //Interactive Data
  const interactiveType = messageObj?.interactive?.type||"";
  const buttonReply = messageObj?.interactive?.button_reply?.title;
  const listReply = messageObj?.interactive?.list_reply?.title;
  const listReplyPostback =
    JSON.parse(messageObj?.interactive?.list_reply?.id || "{}").postbackText || "";
  const buttonReplyPostback =
    JSON.parse(messageObj?.interactive?.button_reply?.id || "{}").postbackText || "";

    console.log('🔍 Interactive Data:\nbutton reply: ', buttonReply, '\nlist reply:', listReply, '\nlist reply postback:', listReplyPostback, '\nbutton reply postback:', buttonReplyPostback);


  //Normal Text Message
  const msg = buttonReplyPostback || listReplyPostback || messageObj?.text?.body || "";;

  console.log('🔍 Message Data:\nmsg:', msg, '\ntype:', messageType, '\ninteractive type:', interactiveType);
  
  const phone = value?.contacts?.[0]?.wa_id || messageObj?.from;

  console.log(`📥 Received from ${phone}: ${msg}`);

  if (!phone || !msg) return res.sendStatus(200);

  let session = await Session.findOne({ phone });
  if (!session) {
    session = await Session.create({ phone, state: "awaiting_email" });
    await sendMessage(phone, "Please enter your *email* to login.");
    return res.sendStatus(200);
  }

  if (session.state === "awaiting_email") {
    // Simple email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(msg.trim())) {
      await sendMessage(
        phone,
        "⚠️ Please enter a valid *email address* to continue."
      );
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
        {
          email: session.email,
          password: msg,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/plain, */*",
            Referer: "https://portal.logistos.in/",
            "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
          },
        }
      );

      console.log("✅ Login Res:", loginRes);

      session.token = loginRes.data.access;
      session.state = "authenticated";
      await session.save();

      getMyDetailsAPI(phone)    

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
      await sendMessage(
        phone,
        "❌ Login failed. Please type your *email* again."
      );
    }
    return res.sendStatus(200);
  }

  // User is authenticated
  if (session.state === "authenticated") {
    const sessionAgeHours = dayjs().diff(dayjs(session.createdAt), "hour");

    console.log('passing to authenticated section');    

    // ✅ Step 1: Validate token
    if (sessionAgeHours >= 24) {
      console.log(`🔒 Session age: ${sessionAgeHours} hours. Validating token...`);
      
      try {
        getMyDetailsAPI(phone);         
      } catch (err) {
        if (err.response?.status === 401) {
          // ❌ Token expired → delete session
          await Session.deleteOne({ phone });
          await sendMessage(
            phone,
            '⚠️ Your session expired. Please login again.\n\nType "hi" to start.'
          );
          return res.sendStatus(200);
        } else {
          console.error("❌ Token validation error:", err.message);
          await sendMessage(
            phone,
            "⚠️ Error verifying your session. Try again later."
          );
          return res.sendStatus(200);
        }
      }
    }
    else if(sessionAgeHours>=48){
      await Session.deleteOne({phone})
      await BookShipment.deleteOne({phone})
      await sendMessage(
        phone,
        '⚠️ Your session expired. Please login again.\n\nType "hi" to start.'
      );
      return res.sendStatus(200);
    }

    // ✅ Step 2: Continue with command processing
    let msg_lower = msg.toLowerCase() || ""; 
    
    if (msg_lower === "hi") {
      await sendQuickReplies(
        phone,
        [
          { title: "Book a Shipment", postbackText: "book" },
          { title: "Track an Order", postbackText: "track" },
          { title: "Logout", postbackText: "logout" },
        ],
        "✅ You are already logged in\n\nWhat would you like to do?",
        "Logistos Bot",
        "Choose an option below"
      );
    } else if (msg_lower === "book"||session.operation === "booking") {
      console.log('🔍 User is booking a shipment...');
      
      try {
        await bookShipmentHelper(phone, session,msg,interactiveType);
        return res.sendStatus(200);
      } catch (err) {
        console.error("❌ Error in bookShipmentHelper:", err.message);
        await sendMessage(
          phone,
          "⚠️ Failed to start booking. Please try again later."
        );
      }
    } else if (msg_lower === "track"||session.operation === "tracking") {
      await trackOrderHelper(phone, msg);
      
    } else if (msg_lower === "logout") {
      await Session.deleteOne({ phone });
      await BookShipment.deleteOne({ phone });
      await sendMessage(
        phone,
        '✅ You have been logged out. Type "hi" to log in again.'
      );
      return res.sendStatus(200);
    } else {
     
      await sendMessage(phone, '*Invalid Prompt!* Type *Hi* to start again.');
    }
    return res.sendStatus(200);
  }

  return res.status(200).json({
    message: {
      type: "text",
      text: "Sorry, I didn't understand that. Please type 'hi' to start again.",
    },
    type: "RESPONSE",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot listening at http://localhost:${PORT}/webhook`);
});
