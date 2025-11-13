// helpers/signupHelper.js
import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import { signupAPI } from "../APIS/signupAPI.js";

// ---------- validators ----------
const isEmail = (s = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
const isPhone10 = (s = "") => /^\d{10}$/.test(String(s).trim());
const isPAN = (s = "") => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(String(s).trim());
const isGST = (s = "") => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(String(s).trim());

/**
 * Bootstraps the signup flow
 */

// --- helper: extract media url and postback consistently ---
function extractMediaAndPostback(rawPayload, msg) {
    const raw = rawPayload || {};
    const obj = (typeof raw === "string") ? (() => { try { return JSON.parse(raw); } catch { return rawPayload; } })() : raw;

    // common shapes
    const mediaUrl =
        obj?.payload?.url ||
        obj?.message?.payload?.url ||
        obj?.payload?.media?.url ||
        obj?.originalMessage?.payload?.url ||
        obj?.attachments?.[0]?.payload?.url ||
        obj?.url ||
        null;

    // postback quick replies / button payloads (varies by adapter)
    const postback =
        obj?.payload?.postback ||
        obj?.postback ||
        obj?.message?.postback ||
        obj?.payload?.text || // some adapters put postback under payload.text
        null;

    // Also return textual message (if any)
    const text = (typeof msg === "string" && msg.trim()) ? msg.trim() : (obj?.payload?.text || obj?.message?.text || "");

    return { mediaUrl, postback, text, raw: obj };
}


export async function startSignupFlow(phone, session) {
    session.state = "signup.chooseType";
    session.signup = { user_type: "", data: {}, files: {} };
    await session.save();

    await sendQuickReplies(
        phone,
        [
            { title: "Organization", postbackText: "type_org" },
            { title: "Individual", postbackText: "type_ind" },
            { title: "Back", postbackText: "back_login" },
        ],
        "Let’s get you onboarded.\nChoose the account type:",
        "Logistos Signup",
        "Select type"
    );
}

/**
 * Central step handler for signup
 * Call this from your webhook whenever session.state starts with "signup."
 */
export async function handleSignupStep(phone, session, msg, interactiveType, rawPayload = {}) {
    if (!session.signup) {
        session.signup = { user_type: "", data: {}, files: {} };
    }
    if (!session.state || !session.state.startsWith("signup.")) {
        session.state = "signup.chooseType";
    }
    await session.save();
    const lower = (msg || "").toLowerCase().trim();

    // Allow switching back to login
    if (lower === "login" || lower === "back_login") {
        session.state = "awaiting_email";
        await session.save();
        await sendMessage(phone, "Redirecting to login. Please enter your *email*.");
        return;
    }

    // ---- choose type ----
    if (session.state === "signup.chooseType") {
        const choose = (t) => {
            session.signup.user_type = t;
            session.state = "signup.collect.basic";
        };

        if (["type_org", "organization", "signup_organization"].includes(lower)) choose("organization");
        else if (["type_ind", "individual", "signup_individual"].includes(lower)) choose("individual");
        else return await sendMessage(phone, "Please choose *Organization* or *Individual*.");

        await session.save();
        await sendMessage(
            phone,
            session.signup.user_type === "organization"
                ? "Please send the following *comma-separated*:\nClient Name, Signatory Name, First Name, Last Name, Email, Phone"
                : "Please send the following *comma-separated*:\nFull Name, Email, Phone"
        );
        return;
    }

    // ---- collect basic ----
    if (session.state === "signup.collect.basic") {
        const parts = msg.split(",").map(s => s.trim()).filter(Boolean);

        if (session.signup.user_type === "organization") {
            if (parts.length < 6) {
                await sendMessage(phone, "Need all 6 fields: Client Name, Signatory Name, First Name, Last Name, Email, Phone");
                return;
            }
            const [client_name, authorised_signatory_name, user_first_name, user_last_name, user_email, client_contact_number] = parts;

            if (!isEmail(user_email)) return sendMessage(phone, "Enter a *valid email*.");
            if (!isPhone10(client_contact_number)) return sendMessage(phone, "Enter a *valid 10-digit phone number*.");

            session.signup.data = {
                client_name,
                authorised_signatory_name,
                user_first_name,
                user_last_name,
                user_email,
                client_contact_number,
                user_type: "organization",
            };
            session.state = "signup.collect.pan";
            await session.save();
            await sendMessage(phone, "Enter *PAN Number* (e.g., ABCDE1234F).");
            return;
        }

        // individual
        if (parts.length < 3) {
            await sendMessage(phone, "Need 3 fields: Full Name, Email, Phone");
            return;
        }
        const [fullName, user_email, client_contact_number] = parts;
        if (!isEmail(user_email)) return sendMessage(phone, "Enter a *valid email*.");
        if (!isPhone10(client_contact_number)) return sendMessage(phone, "Enter a *valid 10-digit phone number*.");

        const nameParts = fullName.split(" ");
        const user_last_name = nameParts.pop() || "";
        const user_first_name = nameParts.join(" ") || fullName;

        session.signup.data = {
            client_name: fullName,
            authorised_signatory_name: fullName,
            user_first_name,
            user_last_name,
            user_email,
            client_contact_number,
            user_type: "individual",
        };
        session.state = "signup.collect.pan";
        await session.save();
        await sendMessage(phone, "Enter *PAN Number* (e.g., ABCDE1234F).");
        return;
    }

    // ---- PAN number ----
    if (session.state === "signup.collect.pan") {
        const pan = msg.replace(/\s/g, "").toUpperCase();
        if (!isPAN(pan)) {
            await sendMessage(phone, "Invalid PAN. Format: 5 letters + 4 digits + 1 letter (e.g., ABCDE1234F).");
            return;
        }
        session.signup.data.pan_no = pan;
        session.state = session.signup.user_type === "organization" ? "signup.collect.gst" : "signup.upload.panFile";
        await session.save();

        if (session.signup.user_type === "organization") {
            await sendMessage(phone, "Enter *GST Number* (e.g., 22ABCDE1234F1Z5).");
        } else {
            await sendQuickReplies(
                phone,
                [
                    { title: "Upload PAN", postbackText: "upload_pan" },
                    { title: "Skip", postbackText: "skip_pan" }
                ],
                "Please *upload PAN card file* now (PDF/JPG/PNG).\nYou can also *Skip* and complete signup without the file.",
                "Upload PAN",
                "Optional"
            );
        }
        return;
    }

    // ---- GST number (org required; individual optional but we mirror web: not shown here for individual) ----
    if (session.state === "signup.collect.gst") {
        const gst = msg.replace(/\s/g, "").toUpperCase();
        if (!isGST(gst)) {
            await sendMessage(phone, "Invalid GST. Format example: 22ABCDE1234F1Z5.");
            return;
        }
        session.signup.data.gst_no = gst;
        session.state = "signup.upload.panFile";
        await session.save();
        await sendQuickReplies(
            phone,
            [
                { title: "Upload PAN", postbackText: "upload_pan" },
                { title: "Skip", postbackText: "skip_pan" }
            ],
            "Please *upload PAN card file* now (PDF/JPG/PNG).\nYou can also *Skip* and complete signup without the file.",
            "Upload PAN",
            "Optional"
        );
        return;
    }

    // ---- PAN file upload ----
    if (session.state === "signup.upload.panFile") {
        const { mediaUrl, postback, text } = extractMediaAndPostback(rawPayload, msg);

        // If user chose skip via quick reply or typed 'skip'
        if ([postback, text?.toLowerCase()].some(v => v === "skip_pan" || v === "skip")) {
            session.signup.files.pan_card_copy_url = null; // explicit: user skipped
            session.state = session.signup.user_type === "organization" ? "signup.upload.gstFile" : "signup.confirm";
            await session.save();

            if (session.signup.user_type === "organization") {
                await sendQuickReplies(
                    phone,
                    [
                        { title: "Upload GST", postbackText: "upload_gst" },
                        { title: "Skip", postbackText: "skip_gst" }
                    ],
                    "You chose to skip PAN upload. Now, please upload *GST Registration Certificate* or Skip.",
                    "Upload GST",
                    "Optional"
                );
            } else {
                await sendMessage(phone, "You chose to skip PAN upload. Almost done. Type *confirm* to submit or *cancel* to discard.");
            }
            return;
        }

        // If a media URL is present, accept it and continue
        if (mediaUrl) {
            session.signup.files.pan_card_copy_url = mediaUrl;
            session.state = session.signup.user_type === "organization" ? "signup.upload.gstFile" : "signup.confirm";
            await session.save();

            if (session.signup.user_type === "organization") {
                await sendQuickReplies(
                    phone,
                    [
                        { title: "Upload GST", postbackText: "upload_gst" },
                        { title: "Skip", postbackText: "skip_gst" }
                    ],
                    "Now upload *GST Registration Certificate* (PDF/JPG/PNG) or choose Skip to continue without it.",
                    "Upload GST",
                    "Optional"
                );
            } else {
                await sendMessage(phone, "PAN received. Almost done. Type *confirm* to submit or *cancel* to discard.");
            }
            return;
        }

        // No media & no skip — re-prompt but show skip option so the user isn't trapped
        await sendQuickReplies(
            phone,
            [
                { title: "Upload PAN", postbackText: "upload_pan" },
                { title: "Skip", postbackText: "skip_pan" }
            ],
            "Please upload a *file* for PAN (PDF/JPG/PNG) — or press *Skip* to continue without uploading.",
            "Upload PAN",
            "Optional"
        );
        return;
    }

    // ---- GST file upload (org only) ----
    if (session.state === "signup.upload.gstFile") {
        const { mediaUrl, postback, text } = extractMediaAndPostback(rawPayload, msg);

        if ([postback, text?.toLowerCase()].some(v => v === "skip_gst" || v === "skip")) {
            session.signup.files.gst_registration_certificate_url = null;
            session.state = "signup.confirm";
            await session.save();
            await sendMessage(phone, "You chose to skip GST upload. Type *confirm* to submit or *cancel* to discard.");
            return;
        }

        if (mediaUrl) {
            session.signup.files.gst_registration_certificate_url = mediaUrl;
            session.state = "signup.confirm";
            await session.save();
            await sendMessage(phone, "Great! Type *confirm* to submit or *cancel* to discard.");
            return;
        }

        await sendQuickReplies(
            phone,
            [
                { title: "Upload GST", postbackText: "upload_gst" },
                { title: "Skip", postbackText: "skip_gst" }
            ],
            "Please upload the *GST Registration Certificate* (PDF/JPG/PNG) — or press *Skip* to continue without uploading.",
            "Upload GST",
            "Optional"
        );
        return;
    }


    // ---- confirm / cancel ----
    if (session.state === "signup.confirm") {
        if (lower === "cancel") {
            delete session.signup;
            session.state = "awaiting_login_or_signup";
            await session.save();
            await sendMessage(phone, "Signup cancelled.");
            return;
        }
        if (lower !== "confirm") {
            await sendMessage(phone, "Type *confirm* to submit or *cancel* to discard.");
            return;
        }

        // Submit
        try {
            session.state = "signup.submitting";
            await session.save();

            // --- Build an explicit payload to avoid missing required fields on the backend ---
            // Ensure client_name and authorised_signatory_name are present
            const sdata = session.signup.data || {};
            const sfiles = session.signup.files || {};

            // If we only have first/last name but not client_name, create one
            const client_name_fallback = sdata.client_name
                || (sdata.user_first_name && sdata.user_last_name && `${sdata.user_first_name} ${sdata.user_last_name}`)
                || (sdata.user_first_name) || "";

            const authorised_signatory_name_fallback =
                sdata.authorised_signatory_name || client_name_fallback;

            const payload = {
                client_name: client_name_fallback,
                authorised_signatory_name: authorised_signatory_name_fallback,
                user_first_name: sdata.user_first_name || "",
                user_last_name: sdata.user_last_name || "",
                user_email: sdata.user_email || sdata.email || "",
                client_contact_number: sdata.client_contact_number || sdata.phone || "",
                pan_no: sdata.pan_no || "",
                gst_no: sdata.gst_no || "",
                created_by: sdata.created_by || "1",
                // file URLs (may be null if user skipped)
                pan_card_copy_url: sfiles.pan_card_copy_url ?? null,
                gst_registration_certificate_url: sfiles.gst_registration_certificate_url ?? null,
            };

            // Optional: quick sanity check before calling API
            // (don't block submit — backend will validate, but this helps surface missing fields quickly)
            // console.log("Signup payload being submitted:", payload);

            const apiRes = await signupAPI(payload);

            // Success — reset user back to login
            session.state = "awaiting_email";
            delete session.signup;
            await session.save();

            await sendMessage(
                phone,
                `✅ Signup successful!\nReference: ${apiRes?.id ?? "N/A"}\nPlease login with your email and password.`
            );
        } catch (e) {
            session.state = "signup.confirm";
            await session.save();

            // Show real error details to the user (and log)
            const apiErr = e?.response?.data || e?.message || e;
            console.error("❌ signupAPI error:", apiErr);

            // If API returned a JSON object with field errors, pretty-print it
            let errText = "";
            try {
                if (typeof apiErr === "object") {
                    errText = JSON.stringify(apiErr, null, 2);
                } else {
                    errText = String(apiErr);
                }
            } catch {
                errText = String(apiErr);
            }

            // Send the real error back to user (trim if too long)
            const short = errText.length > 900 ? errText.slice(0, 900) + "...(truncated)" : errText;
            await sendMessage(phone, `❌ Signup failed: ${short}`);

            // Helpful tip message so the user knows what to try
            await sendMessage(phone, "If the error mentions missing fields, please re-check your inputs or restart signup by typing *signup*.");
        }
        return;
    }
}
