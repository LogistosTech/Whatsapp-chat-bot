// APIS/createTicketAPI.js
import axios from "axios";
import Session from "../models/sessionModel.js";

/**
 * Creates a ticket using the logged-in user's bearer token.
 * @param {string} phone - WhatsApp phone (to read session/token)
 * @param {object} data  - payload: { client_id, subtype_key, shipment_id?, awb?, details?, assigned_team_key? }
 * @returns {Promise<object>} TicketResponse
 */
const createTicketAPI = async (phone, data) => {
    try {
        const session = await Session.findOne({ phone });
        if (!session?.token) {
            throw new Error("Missing auth token");
        }

        const resp = await axios.post(
            "https://admin.logistos.in/seller/tickets/",
            data,
            {
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    Accept: "application/json, text/plain, */*",
                    Referer: "https://portal.logistos.in/",
                    "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            }
        );

        return resp.data;
    } catch (err) {
        console.error("❌ Error in createTicketAPI:", err?.response?.data || err.message || err);
        throw err;
    }
};

export default createTicketAPI;
