import axios from "axios";
import Session from "../models/sessionModel.js";

const getMyDetailsAPI = async (phone) => {
  try {
    console.log(`📦 Fetching user details for phone: ${phone}`);

    const session = await Session.findOne({ phone });

    const resp = await axios.get(
      "https://admin.logistos.in/seller/users/get_my_details/",
      {
        headers: {
          Authorization: `Bearer ${session.token}`,
          Accept: "application/json, text/plain, */*",
          Referer: "https://portal.logistos.in/",
          "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
        },
      }
    );

    console.log("✅ Token validation response:", resp.data);

    session.clientId = Number(resp.data.client_poc?.id) || 0;
    session.save();

    // Fetch the session data for the given phone number
  } catch (err) {
    console.error("❌ Error in getMyDetailsAPI:", err.message);
    throw err; // Re-throw to handle it in the calling function
  }
};

export default getMyDetailsAPI;
