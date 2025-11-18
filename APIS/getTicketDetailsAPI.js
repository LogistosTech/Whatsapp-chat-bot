// APIS/getTicketDetailsAPI.js
import axios from "axios";
import Session from "../models/sessionModel.js";

/**
 * Fetch details for one or more ticket IDs using logged-in user's bearer token.
 * @param {string} phone - WhatsApp phone (to read session/token)
 * @param {number[]} ticketIds - array of ticket IDs
 * @returns {Promise<any>} API response data
 */
const getTicketDetailsAPI = async (phone, ticketIds = []) => {
    try {
        const session = await Session.findOne({ phone });
        if (!session?.token) {
            throw new Error("Missing auth token");
        }

        const payload = { ticket_ids: ticketIds };

        const resp = await axios.post(
            "https://admin.logistos.in/seller/tickets-details/",
            payload,
            {
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    Accept: "application/json, text/plain, */*",
                    "Content-Type": "application/json",
                    Referer: "https://portal.logistos.in/",
                    "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
                },
                timeout: 15000,
            }
        );

        return resp.data;
    } catch (err) {
        console.error(
            "❌ Error in getTicketDetailsAPI:",
            err?.response?.data || err.message || err
        );
        throw err;
    }
};

export default getTicketDetailsAPI;
