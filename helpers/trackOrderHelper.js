import axios from "axios";
import sendListMessage from "../functions/sendListMessage.js";
import Session from "../models/sessionModel.js";
import BookShipment from "../models/bookShipmentModel.js";
import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import trackShipmentAPI from "../APIS/trackShipmentAPI.js";

const trackOrderHelper = async (phone, msg = "") => {
  try {
    let session = await Session.findOne({ phone });

    if (session.operation === null || session.operation === "booking") {
      session.operation = "tracking";
      await session.save();
    }

    if (msg.toLowerCase() === "restart") {
      console.log(`📦 Restarting tracking operation for phone: ${phone}`);
      await sendMessage(
        phone,
        "Tracking operation has been restarted. Please enter your *Order ID* to track."
      );

      session.operation = null;
      await session.save();
      return;
    }

    if (msg.toLowerCase() === "logout") {
      console.log(`📦 Logging out for phone: ${phone}`);
      await sendMessage(
        phone,
        "You have been logged out. Type *hi* to log in again."
      );
      await Session.deleteOne({ phone });
      await BookShipment.deleteOne({ phone });
      return;
    }

    let tracking = session.trackingStatus;

    switch (tracking) {
      case "init":
        console.log(`📦 Initializing tracking for phone: ${phone}`);
        await sendMessage(phone, "Please enter your *AWB/LR Id* to track.");
        session.trackingStatus = "in_progress";
        await session.save();
        break;

      case "in_progress":
        console.log(`📦 Tracking in progress for phone: ${phone}`);
        await sendMessage(
          phone,
          "Tracking is already in progress. Please wait for the update."
        );
        const resp = await trackShipmentAPI(phone, msg);
        const orderId = resp.id;
        const status = resp.status_dp || resp.status;
        const pickupDateTime = new Date(resp.pickup_date_time).toLocaleString(
          "en-IN",
          {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }
        );

        const fromLocation = `${resp.from_city}, ${resp.from_state}`;
        const toLocation = `${resp.to_city}, ${resp.to_state}`;
        const partner = resp.delivery_partner_name;
        const mode = resp.mode_common_name;

        // build status history dynamically
        let statusHistoryText = "";

        if (resp.status_history && resp.status_history.length > 0) {
          resp.status_history.forEach((entry) => {
            const dateObj = new Date(entry.added_at);
            const date = dateObj.toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
            });
            const time = dateObj.toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            });

            const icon =
              entry.status.toUpperCase() === "NOT_PICKED" ? "⚠️" : "✅";
            statusHistoryText += `
                📅 *${date}*
                ${icon} ${entry.status} - ${entry.location} at ${time}
                📝 Reason: ${entry.reason}
                `;
          });
        } else {
          statusHistoryText = "⚠️ *Status history is not available.*";
        }

        const message = `🚚 *Tracking Details*\n*Order #${orderId}*\n🔵 Status: ${status}\n🕒 Pickup: ${pickupDateTime}\n📍 *From*: ${fromLocation}\n📍 *To*: ${toLocation}\n🤝 *Partner*: ${partner}\n🚛 *Mode*: ${mode}\n\n*Status History*\n${statusHistoryText}`;

        await sendMessage(phone, message);

        await new Promise((resolve) => setTimeout(resolve, 500));

        await sendQuickReplies(
          phone,
          [
            { title: "Book a Shipment", postbackText: "book" },
            { title: "Track an Order", postbackText: "track" },
            { title: "Create Ticket", postbackText: "ticket" },
            { title: "Logout", postbackText: "logout" },
          ],
          "What next?",
          "Logistos Bot",
          "Choose an option below"
        );

        session.trackingStatus = "completed";
        await session.save();
        break;

      case "completed":
        console.log(`📦 Tracking completed for phone: ${phone}`);
        if (msg.toLowerCase() === "track") {
          await sendMessage(phone, "Please enter your *AWB/LR Id* to track.");
          session.trackingStatus = "in_progress";
          await session.save();
        } else {
          session.trackingStatus = "init";
          session.operation = "tracking";
          await session.save();
        }
        break;

      default:
        console.log(`📦 Unknown tracking status for phone: ${phone}`);
        await sendMessage(phone, "Unknown tracking status. Please try again.");
        break;
    }
  } catch (err) {
    console.error("❌ Error in trackOrderHelper:", err.message);
    throw err; // Re-throw to handle it in the calling function
  }
};

export default trackOrderHelper;
