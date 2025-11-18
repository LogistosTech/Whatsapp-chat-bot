// helpers/signupHelper.js
import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import { signupAPI } from "../APIS/signupAPI.js";

// In-memory store for signup data, keyed by phone.
// This avoids issues with Mongo schema not persisting nested objects.
const signupStore = new Map();

/* ---------------------- Validators (from web form) ---------------------- */

const isEmail = (s = "") =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());

const isPhone10 = (s = "") =>
    /^\d{10}$/.test(String(s).trim());

const isPAN = (s = "") =>
    /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(String(s).trim());

const isGST = (s = "") =>
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
        String(s).trim()
    );

/* ----------------------------- Start flow ----------------------------- */

export async function startSignupFlow(phone, session) {
    signupStore.set(phone, {
        user_type: "",
        data: {},
    });

    session.state = "signup.chooseType";
    await session.save();

    await sendQuickReplies(
        phone,
        [
            { title: "Organization", postbackText: "type_org" },
            { title: "Individual", postbackText: "type_ind" },
            { title: "Back", postbackText: "back_login" },
        ],
        "Let’s get you onboarded.\nPlease choose your account type:",
        "Logistos Signup",
        "Select type"
    );
}

/* ---------------------------- Main handler ---------------------------- */

export async function handleSignupStep(
    phone,
    session,
    msg,
    interactiveType,
    rawPayload = {}
) {
    const text = (msg || "").trim();
    const lower = text.toLowerCase();

    // quick escape back to login
    if (["login", "back_login", "back"].includes(lower)) {
        signupStore.delete(phone);
        session.state = "awaiting_email";
        await session.save();
        await sendMessage(phone, "Redirecting to login. Please enter your *email*.");
        return;
    }

    // must be in a signup state
    if (!session.state || !session.state.startsWith("signup.")) {
        await sendMessage(
            phone,
            "It looks like your signup session expired. Please type *signup* to start again."
        );
        signupStore.delete(phone);
        session.state = "awaiting_login_or_signup";
        await session.save();
        return;
    }

    // get in-memory signup data
    let signup = signupStore.get(phone);
    if (!signup) {
        // nothing stored – treat as expired
        await sendMessage(
            phone,
            "It looks like your signup session expired. Please type *signup* to start again."
        );
        signupStore.delete(phone);
        session.state = "awaiting_login_or_signup";
        await session.save();
        return;
    }

    const data = signup.data;

    /* -------------------------- Choose type step -------------------------- */

    if (session.state === "signup.chooseType") {
        if (["type_org", "organization", "org", "1"].includes(lower)) {
            signup.user_type = "organization";
            signupStore.set(phone, signup);
            session.state = "signup.org.client_name";
            await session.save();

            await sendMessage(
                phone,
                "You selected *Organization*.\n\n" +
                "Please enter your *Client Name* (Business / Company Name):"
            );
            return;
        }

        if (["type_ind", "individual", "ind", "2"].includes(lower)) {
            signup.user_type = "individual";
            signupStore.set(phone, signup);
            session.state = "signup.ind.client_name";
            await session.save();

            await sendMessage(
                phone,
                "You selected *Individual*.\n\n" +
                "Please enter your *Full Name*:"
            );
            return;
        }

        await sendMessage(
            phone,
            "Please choose a valid option:\n*Organization* or *Individual*."
        );
        return;
    }

    /* ============================= ORG FLOW ============================== */

    if (signup.user_type === "organization") {
        // Client Name
        if (session.state === "signup.org.client_name") {
            if (!text) {
                await sendMessage(
                    phone,
                    "Client Name is required.\nPlease enter your *Client Name*:"
                );
                return;
            }
            data.client_name = text;
            // per requirement: signatory = client_name
            data.authorised_signatory_name = text;

            signupStore.set(phone, signup);
            session.state = "signup.org.first_name";
            await session.save();

            await sendMessage(
                phone,
                "Please enter *First Name* of the primary user:"
            );
            return;
        }

        // First Name
        if (session.state === "signup.org.first_name") {
            if (!text) {
                await sendMessage(
                    phone,
                    "First Name is required.\nPlease enter your *First Name*:"
                );
                return;
            }
            data.user_first_name = text;

            signupStore.set(phone, signup);
            session.state = "signup.org.last_name";
            await session.save();

            await sendMessage(phone, "Please enter *Last Name*:");
            return;
        }

        // Last Name
        if (session.state === "signup.org.last_name") {
            if (!text) {
                await sendMessage(
                    phone,
                    "Last Name is required.\nPlease enter your *Last Name*:"
                );
                return;
            }
            data.user_last_name = text;

            signupStore.set(phone, signup);
            session.state = "signup.org.email";
            await session.save();

            await sendMessage(phone, "Please enter your *Email*:");
            return;
        }

        // Email
        if (session.state === "signup.org.email") {
            if (!isEmail(text)) {
                await sendMessage(
                    phone,
                    "That doesn't look like a valid email.\n" +
                    "Please enter a *valid Email* (example: name@example.com):"
                );
                return;
            }
            data.user_email = text;

            signupStore.set(phone, signup);
            session.state = "signup.org.phone";
            await session.save();

            await sendMessage(
                phone,
                "Please enter your *10-digit Phone Number* (digits only):"
            );
            return;
        }

        // Phone
        if (session.state === "signup.org.phone") {
            const digits = text.replace(/\D/g, "");
            if (!isPhone10(digits)) {
                await sendMessage(
                    phone,
                    "Please enter a *valid 10-digit Phone Number* (digits only):"
                );
                return;
            }
            data.client_contact_number = digits;

            signupStore.set(phone, signup);
            session.state = "signup.org.pan";
            await session.save();

            await sendMessage(
                phone,
                "Please enter your *PAN Number* (e.g., ABCDE1234F):"
            );
            return;
        }

        // PAN
        if (session.state === "signup.org.pan") {
            const pan = text.toUpperCase().replace(/\s/g, "");
            if (!isPAN(pan)) {
                await sendMessage(
                    phone,
                    "Invalid PAN format.\n" +
                    "PAN should be 5 letters, 4 digits, 1 letter (e.g., ABCDE1234F).\n\n" +
                    "Please enter your *PAN Number* again:"
                );
                return;
            }
            data.pan_no = pan;

            signupStore.set(phone, signup);
            session.state = "signup.org.gst";
            await session.save();

            await sendMessage(
                phone,
                "Please enter your *GST Number* (e.g., 22ABCDE1234F1Z5):"
            );
            return;
        }

        // GST (required for org)
        if (session.state === "signup.org.gst") {
            const gst = text.toUpperCase().replace(/\s/g, "");
            if (!isGST(gst)) {
                await sendMessage(
                    phone,
                    "Invalid GST format.\nExample: 22ABCDE1234F1Z5.\n\n" +
                    "Please enter your *GST Number* again:"
                );
                return;
            }
            data.gst_no = gst;

            signupStore.set(phone, signup);
            session.state = "signup.review";
            await session.save();

            await sendReviewMessage(phone, signup);
            return;
        }
    }

    /* ========================== INDIVIDUAL FLOW ========================= */

    if (signup.user_type === "individual") {
        // Client Name / Full Name
        if (session.state === "signup.ind.client_name") {
            if (!text) {
                await sendMessage(
                    phone,
                    "Full Name is required.\nPlease enter your *Full Name*:"
                );
                return;
            }
            const fullName = text;
            const parts = fullName.trim().split(/\s+/);
            const last = parts.length > 1 ? parts.pop() : "";
            const first = parts.join(" ") || fullName;

            data.client_name = fullName;
            data.authorised_signatory_name = fullName; // requirement
            data.user_first_name = first;
            data.user_last_name = last || "";

            signupStore.set(phone, signup);
            session.state = "signup.ind.email";
            await session.save();

            await sendMessage(phone, "Please enter your *Email*:");
            return;
        }

        // Email
        if (session.state === "signup.ind.email") {
            if (!isEmail(text)) {
                await sendMessage(
                    phone,
                    "That doesn't look like a valid email.\n" +
                    "Please enter a *valid Email* (example: name@example.com):"
                );
                return;
            }
            data.user_email = text;

            signupStore.set(phone, signup);
            session.state = "signup.ind.phone";
            await session.save();

            await sendMessage(
                phone,
                "Please enter your *10-digit Phone Number* (digits only):"
            );
            return;
        }

        // Phone
        if (session.state === "signup.ind.phone") {
            const digits = text.replace(/\D/g, "");
            if (!isPhone10(digits)) {
                await sendMessage(
                    phone,
                    "Please enter a *valid 10-digit Phone Number* (digits only):"
                );
                return;
            }
            data.client_contact_number = digits;

            signupStore.set(phone, signup);
            session.state = "signup.ind.pan";
            await session.save();

            await sendMessage(
                phone,
                "Please enter your *PAN Number* (e.g., ABCDE1234F):"
            );
            return;
        }

        // PAN
        if (session.state === "signup.ind.pan") {
            const pan = text.toUpperCase().replace(/\s/g, "");
            if (!isPAN(pan)) {
                await sendMessage(
                    phone,
                    "Invalid PAN format.\n" +
                    "PAN should be 5 letters, 4 digits, 1 letter (e.g., ABCDE1234F).\n\n" +
                    "Please enter your *PAN Number* again:"
                );
                return;
            }
            data.pan_no = pan;

            signupStore.set(phone, signup);
            session.state = "signup.ind.gst";
            await session.save();

            await sendQuickReplies(
                phone,
                [
                    { title: "Enter GST", postbackText: "enter_gst" },
                    { title: "Skip", postbackText: "skip_gst" },
                ],
                "If you have a *GST Number*, please enter it now.\n" +
                "Otherwise, you can *Skip*.",
                "GST Number",
                "Optional"
            );
            return;
        }

        // GST (optional for individual)
        if (session.state === "signup.ind.gst") {
            if (["skip_gst", "skip"].includes(lower)) {
                data.gst_no = "";
            } else if (text) {
                const gst = text.toUpperCase().replace(/\s/g, "");
                if (!isGST(gst)) {
                    await sendMessage(
                        phone,
                        "Invalid GST format.\nExample: 22ABCDE1234F1Z5.\n\n" +
                        "Please enter your *GST Number* again or type *skip*:"
                    );
                    return;
                }
                data.gst_no = gst;
            } else {
                data.gst_no = "";
            }

            signupStore.set(phone, signup);
            session.state = "signup.review";
            await session.save();

            await sendReviewMessage(phone, signup);
            return;
        }
    }

    /* ================================ REVIEW ============================== */

    if (session.state === "signup.review") {
        if (["1", "confirm", "submit", "confirm & submit"].includes(lower)) {
            await performSubmit(phone, session, signup);
            return;
        }

        if (["2", "restart", "start over"].includes(lower)) {
            signupStore.delete(phone);
            signupStore.set(phone, { user_type: "", data: {} });

            session.state = "signup.chooseType";
            await session.save();

            await sendQuickReplies(
                phone,
                [
                    { title: "Organization", postbackText: "type_org" },
                    { title: "Individual", postbackText: "type_ind" },
                ],
                "Alright, let's start again.\nPlease choose your account type:",
                "Logistos Signup",
                "Select type"
            );
            return;
        }

        if (["3", "cancel"].includes(lower)) {
            signupStore.delete(phone);
            session.state = "awaiting_login_or_signup";
            await session.save();

            await sendMessage(
                phone,
                "Signup cancelled. You can type *signup* anytime to start again."
            );
            return;
        }

        await sendMessage(
            phone,
            "Please reply with:\n*1* – Confirm & Submit\n*2* – Start Over\n*3* – Cancel"
        );
        return;
    }

    // fallback
    await sendMessage(
        phone,
        "Something went wrong with the signup flow. Please type *signup* to start again."
    );
    signupStore.delete(phone);
    session.state = "awaiting_login_or_signup";
    await session.save();
}

/* ------------------------ Review message helper ------------------------ */

async function sendReviewMessage(phone, signup) {
    const { user_type, data } = signup;
    const isOrg = user_type === "organization";

    const lines = [
        "*Please review your details:*",
        "",
        `Account Type: *${isOrg ? "Organization" : "Individual"}*`,
        `Client Name: *${data.client_name || "-"}*`,
        `Signatory Name: *${data.authorised_signatory_name || "-"}*`,
        `First Name: *${data.user_first_name || "-"}*`,
        `Last Name: *${data.user_last_name || "-"}*`,
        `Email: *${data.user_email || "-"}*`,
        `Phone: *${data.client_contact_number || "-"}*`,
        `PAN Number: *${data.pan_no || "-"}*`,
        `GST Number: *${data.gst_no || (isOrg ? "-" : "Not provided")}*`,
        "",
        "If everything looks correct, please choose:",
        "*1* – Confirm & Submit",
        "*2* – Start Over",
        "*3* – Cancel",
    ];

    await sendMessage(phone, lines.join("\n"));
}

/* ------------------------ Submit to backend API ------------------------ */

async function performSubmit(phone, session, signup) {
    const { user_type, data } = signup;

    // Local required checks (mirroring web)
    if (!data.client_name || !data.user_email || !data.client_contact_number || !data.pan_no) {
        await sendMessage(
            phone,
            "Some required fields are missing.\n" +
            "Please type *signup* to start again and fill all details."
        );
        signupStore.delete(phone);
        session.state = "awaiting_login_or_signup";
        await session.save();
        return;
    }

    if (user_type === "organization" && !data.gst_no) {
        await sendMessage(
            phone,
            "GST Number is required for organizations. Please type *signup* to start again."
        );
        signupStore.delete(phone);
        session.state = "awaiting_login_or_signup";
        await session.save();
        return;
    }

    try {
        session.state = "signup.submitting";
        await session.save();

        const payload = {
            client_name: data.client_name,
            authorised_signatory_name:
                data.authorised_signatory_name || data.client_name,
            user_first_name: data.user_first_name || "",
            user_last_name: data.user_last_name || "",
            user_email: data.user_email,
            client_contact_number: data.client_contact_number,
            pan_no: data.pan_no,
            gst_no: data.gst_no || "",
            created_by: "1",
            user_type: user_type,
        };

        console.log("Signup payload being submitted:", payload);

        const apiRes = await signupAPI(payload);

        signupStore.delete(phone);
        session.state = "awaiting_email";
        await session.save();

        await sendMessage(
            phone,
            "✅ *Signup successful!*\n\n" +
            "Your onboarding is in process. Please check your email.\n\n" +
            "Now, please login with your email and password."
        );
    } catch (e) {
        const apiErr = e?.response?.data || e?.message || e;
        console.error("❌ signupAPI error:", apiErr);

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

        const short =
            errText.length > 900 ? errText.slice(0, 900) + "...(truncated)" : errText;

        await sendMessage(
            phone,
            `❌ Signup failed. The server responded with:\n\`\`\`\n${short}\n\`\`\`\n` +
            "Please review the message and try again, or type *signup* to start over."
        );

        // Stay in review so user can decide what to do
        session.state = "signup.review";
        await session.save();
    }
}
