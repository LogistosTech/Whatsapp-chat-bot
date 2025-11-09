// APIS/getRatesAPI.js
import axios from "axios";
import Session from "../models/sessionModel.js";

export default async function getRatesAPI(phone, payload) {
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
    return data; // object keyed by "<Partner>-<mode>"
}
