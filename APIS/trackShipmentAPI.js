import axios from "axios";
import Session from "../models/sessionModel.js";

const trackShipmentAPI = async (phone, shipmentId) => { 

    try {
        console.log(`📦 Tracking shipment for phone: ${phone}, Shipment ID: ${shipmentId}`);
    
        // Fetch the session data for the given phone number
        const session = await Session.findOne({ phone });
    
        if (!session) {
        throw new Error("Session not found");
        }
    
        const resp = await axios.get(
        `https://admin.logistos.in/seller/awb/track/${shipmentId}/`,
        {
            headers: {
            Authorization: `Bearer ${session.token}`,
            Accept: "application/json, text/plain, */*",
            Referer: "https://portal.logistos.in/",
            "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
            },
        }
        );
    
        console.log("✅ Shipment tracking response:", resp.data);
        return resp.data;
    } catch (err) {
        console.error("❌ Error in trackShipmentAPI:", err.message);
        throw err; // Re-throw to handle it in the calling function
    }
}

export default trackShipmentAPI;