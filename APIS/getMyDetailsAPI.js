// APIS/getMyDetailsAPI.js
import axios from "axios";
import Session from "../models/sessionModel.js";

const getMyDetailsAPI = async (phone) => {
  try {
    console.log(`📦 Fetching user details for phone: ${phone}`);

    const session = await Session.findOne({ phone });
    if (!session?.token) {
      throw new Error("Missing auth token on session");
    }

    const resp = await axios.get(
      "https://admin.logistos.in/seller/users/get_my_details/",
      {
        headers: {
          Authorization: `Bearer ${session.token}`,
          Accept: "application/json, text/plain, */*",
          Referer: "https://portal.logistos.in/",
          "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
        },
        timeout: 15000,
      }
    );

    console.log("✅ User details response:", resp.data);

    // ✅ Save the correct numeric client_id (required by ticket API)
    const clientIdFromAPI = resp.data?.client_poc?.client?.id;
    if (!clientIdFromAPI) {
      console.warn("⚠️ client_poc.client.id missing in get_my_details response");
    }
    session.client_id = Number(clientIdFromAPI) || 0;   // <-- the field your ticket flow reads
    // (optional) keep legacy field in sync if you still use it elsewhere
    session.clientId = session.client_id;

    await session.save(); // <-- await!

    // return data in case callers want it
    return resp.data;
  } catch (err) {
    console.error("❌ Error in getMyDetailsAPI:", err.response?.data || err.message);
    throw err;
  }
};

export default getMyDetailsAPI;
