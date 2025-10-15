import axios from "axios";
import Session from "../models/sessionModel.js";

const walletBalanceAPI = async (phone) => {
  try {
    console.log(`💰 Fetching wallet balance for phone: ${phone}`);
    
    const session = await Session.findOne({ phone });

    const resp = await axios.get(
      "https://admin.logistos.in/seller/credit-stats/",
      {
        headers: {
          Authorization: `Bearer ${session.token}`,
          Accept: "application/json, text/plain, */*",
          Referer: "https://portal.logistos.in/",
          "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
        },
      }
    );

    return resp.data;
  } catch (error) {
    console.error("❌ Error fetching wallet balance:", error.message);
    throw new Error("Failed to fetch wallet balance");
  }
}

export default walletBalanceAPI;