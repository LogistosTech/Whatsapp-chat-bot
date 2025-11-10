// APIS/getRatesAPI.js
import axios from "axios";
import Session from "../models/sessionModel.js";

/**
 * Fetch shipment rate estimates
 * @param {string} phone - user phone number to identify session
 * @param {object} payload - shipment rate request payload
 */
export async function getRatesAPI(phone, payload) {
    const session = await Session.findOne({ phone });
    if (!session?.token) throw new Error("Not authenticated");

    const url = "https://admin.logistos.in/seller/get_shipment_charges/";
    const headers = {
        Authorization: `Bearer ${session.token}`,
        Accept: "application/json, text/plain, */*",
        Referer: "https://portal.logistos.in/",
        "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
        "Content-Type": "application/json",
    };

    const { data } = await axios.post(url, payload, { headers });
    return data; // response object keyed by "<Partner>-<mode>"
}

/**
 * Fetch city/state details for a given pincode
 * @param {string} phone - user phone number to identify session
 * @param {string|number} pincode - 6-digit postal code
 * @returns {Promise<{ city: string, state: string }>}
 */
export async function getPincodeAPI(phone, pincode) {
    const session = await Session.findOne({ phone });
    if (!session?.token) throw new Error("Not authenticated");

    const url = `https://admin.logistos.in/seller/utils/get_pincode_details?pincode=${pincode}`;
    const headers = {
        Authorization: `Bearer ${session.token}`,
        Accept: "application/json, text/plain, */*",
        Referer: "https://portal.logistos.in/",
        "User-Agent": "Mozilla/5.0 (WhatsAppBot)",
    };

    const { data } = await axios.get(url, { headers });

    // Expected: { "location": ["CityName", "StateName"] }
    if (!data?.location || data.location.length < 2)
        throw new Error("Invalid pincode or incomplete data");

    const [city, state] = data.location;
    return { city, state };
}
