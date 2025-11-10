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
        if (["type_org", "organization", "signup_organization"].includes(lower)) {
            session.signup.user_type = "organization";
        } else if (["type_ind", "individual", "signup_individual"].includes(lower)) {
            session.signup.user_type = "individual";
        } else {
            await sendMessage(phone, "Please choose *Organization* or *Individual*.");
            return;
        }
        session.state = "signup.collect.basic";
        await session.save();

        // Ask basics (mirror web form)  :contentReference[oaicite:0]{index=0}
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
            await sendMessage(phone, "Please *upload PAN card file* now (PDF/JPG/PNG).");
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
        await sendMessage(phone, "Please *upload PAN card file* now (PDF/JPG/PNG).");
        return;
    }

    // ---- PAN file upload ----
    if (session.state === "signup.upload.panFile") {
        // Expect a media message; for Gupshup, rawPayload.payload.url (varies by type)
        const mediaUrl = rawPayload?.payload?.url || rawPayload?.payload?.media?.url || rawPayload?.url;
        if (!mediaUrl) {
            await sendMessage(phone, "Please upload a *file* for PAN (PDF/JPG/PNG).");
            return;
        }
        session.signup.files.pan_card_copy_url = mediaUrl;
        session.state = session.signup.user_type === "organization" ? "signup.upload.gstFile" : "signup.confirm";
        await session.save();

        if (session.signup.user_type === "organization") {
            await sendMessage(phone, "Now upload *GST Registration Certificate* (PDF/JPG/PNG).");
        } else {
            await sendMessage(phone, "Almost done. Type *confirm* to submit or *cancel* to discard.");
        }
        return;
    }

    // ---- GST file upload (org only) ----
    if (session.state === "signup.upload.gstFile") {
        const mediaUrl = rawPayload?.payload?.url || rawPayload?.payload?.media?.url || rawPayload?.url;
        if (!mediaUrl) {
            await sendMessage(phone, "Please upload the *GST Registration Certificate* (PDF/JPG/PNG).");
            return;
        }
        session.signup.files.gst_registration_certificate_url = mediaUrl;
        session.state = "signup.confirm";
        await session.save();
        await sendMessage(phone, "Great! Type *confirm* to submit or *cancel* to discard.");
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

            const payload = {
                ...session.signup.data,
                ...session.signup.files,
            };

            const apiRes = await signupAPI(payload);

            // Reset to login like web UI escalation popup does after success  :contentReference[oaicite:1]{index=1}
            session.state = "awaiting_email";
            await session.save();

            await sendMessage(
                phone,
                `✅ Signup successful!\nReference: ${apiRes?.id ?? "N/A"}\nPlease login with your email and password.`
            );
        } catch (e) {
            session.state = "signup.confirm";
            await session.save();
            // Mirror web: show duplication hint  :contentReference[oaicite:2]{index=2}
            await sendMessage(phone, "❌ Signup failed. Email or Client Name may already exist. Try different details.");
        }
        return;
    }
}
