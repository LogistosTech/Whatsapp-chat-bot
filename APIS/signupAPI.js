// APIS/signupAPI.js
import axios from "axios";
import FormData from "form-data";

/**
 * Downloads a remote file (e.g., from Gupshup media URL) and appends it to FormData.
 * @param {FormData} formData
 * @param {string} fieldName
 * @param {string} url
 * @param {string} filename
 */
export async function appendRemoteFile(formData, fieldName, url, filename = "document") {
    if (!url) return;
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const contentType = resp.headers["content-type"] || "application/octet-stream";
    formData.append(fieldName, Buffer.from(resp.data), { filename, contentType });
}

/**
 * Seller self-onboarding API (multipart/form-data)
 * Mirrors your web code submission behavior.
 * Endpoint: https://admin.logistos.in/api/client/seller-self-onboarding/
 */
export async function signupAPI(payload) {
    const form = new FormData();

    // Attach scalar fields
    for (const [k, v] of Object.entries(payload)) {
        if (v == null) continue;
        // Files handled separately; skip fields that are objects for safety.
        if (typeof v !== "object") form.append(k, String(v));
    }

    // Optional: 'created_by' like in web form
    if (!("created_by" in payload)) form.append("created_by", "1");

    // Attach files (if already Buffers/Streams)
    if (payload.pan_card_copy && payload.pan_card_copy.buffer) {
        form.append("pan_card_copy", payload.pan_card_copy.buffer, {
            filename: payload.pan_card_copy.filename || "pan_card.pdf",
            contentType: payload.pan_card_copy.contentType || "application/pdf",
        });
    }
    if (payload.gst_registration_certificate && payload.gst_registration_certificate.buffer) {
        form.append("gst_registration_certificate", payload.gst_registration_certificate.buffer, {
            filename: payload.gst_registration_certificate.filename || "gst_certificate.pdf",
            contentType: payload.gst_registration_certificate.contentType || "application/pdf",
        });
    }

    // Or attach files from remote URLs (Gupshup media)
    if (payload.pan_card_copy_url && !payload.pan_card_copy) {
        await appendRemoteFile(form, "pan_card_copy", payload.pan_card_copy_url, "pan_card");
    }
    if (payload.gst_registration_certificate_url && !payload.gst_registration_certificate) {
        await appendRemoteFile(form, "gst_registration_certificate", payload.gst_registration_certificate_url, "gst_certificate");
    }

    try {
        const res = await axios.post(
            "https://admin.logistos.in/api/client/seller-self-onboarding/",
            form,
            { headers: { ...form.getHeaders(), Accept: "application/json, text/plain, */*" } }
        );
        return res.data;
    } catch (err) {
        const msg = err.response?.data || err.message;
        console.error("❌ signupAPI error:", msg);
        throw err;
    }
}
