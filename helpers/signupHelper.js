// helpers/signupHelper.js
import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import { signupAPI } from "../APIS/signupAPI.js";

// ---------- validators (mirroring web) ----------
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

// ---------- start flow ----------
export async function startSignupFlow(phone, session) {
    session.state = "signup.chooseType";
    session.signup = {
        user_type: "",
        data: {},
    };
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

// ---------- central handler ----------
export async function handleSignupStep(
    phone,
    session,
    msg,
    interactiveType,
    rawPayload = {}
) {
    const text = (msg || "").trim();
    const lower = text.toLowerCase();

    // If signup object is missing or state not in signup.*, tell user to restart
    if (!session.signup || !session.state || !session.state.startsWith("signup.")) {
        await sendMessage(
            phone,
            "It looks like your signup session expired. Please type *signup* to start again."
        );
        session.state = "awaiting_login_or_signup";
        delete session.signup;
        await session.save();
        return;
    }

    // Quick escape back to login
    if (["login", "back_login", "back"].includes(lower)) {
        session.state = "awaiting_email";
        delete session.signup;
        await session.save();
        await sendMessage(phone, "Redirecting to login. Please enter your *email*.");
        return;
    }

    const signup = session.signup;
    const data = signup.data || (signup.data = {});

    // ---------- STEP: choose type ----------
    if (session.state === "signup.chooseType") {
        if (["type_org", "organization", "org", "1"].includes(lower)) {
            signup.user_type = "organization";
            session.state = "signup.org.client_name";
            await session.save();
            await sendMessage(
                phone,
                "You selected *Organization*.\n\nPlease enter your *Client Name* (Business / Company Name):"
            );
            return;
        }

        if (["type_ind", "individual", "ind", "2"].includes(lower)) {
            signup.user_type = "individual";
            session.state = "signup.ind.client_name";
            await session.save();
            await sendMessage(
                phone,
                "You selected *Individual*.\n\nPlease enter your *Full Name*:"
            );
            return;
        }

        await sendMessage(
            phone,
            "Please choose a valid option:\n*Organization* or *Individual*."
        );
        return;
    }

    // ========================================================================
    //                           ORGANIZATION FLOW
    // ========================================================================
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
            // requirement: authorised_signatory_name = client_name
            data.authorised_signatory_name = text;

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
                    "That doesn't look like a valid email.\nPlease enter a *valid Email* (example: name@example.com):"
                );
                return;
            }
            data.user_email = text;

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
                    "Invalid PAN format.\nPAN should be 5 letters, 4 digits, 1 letter (e.g., ABCDE1234F).\n\nPlease enter your *PAN Number* again:"
                );
                return;
            }
            data.pan_no = pan;

            session.state = "signup.org.gst";
            await session.save();
            await sendMessage(
                phone,
                "Please enter your *GST Number* (e.g., 22ABCDE1234F1Z5):"
            );
            return;
        }

        // GST (required for organization)
        if (session.state === "signup.org.gst") {
            const gst = text.toUpperCase().replace(/\s/g, "");
            if (!isGST(gst)) {
                await sendMessage(
                    phone,
                    "Invalid GST format.\nExample: 22ABCDE1234F1Z5.\n\nPlease enter your *GST Number* again:"
                );
                return;
            }
            data.gst_no = gst;

            // Move to review
            session.state = "signup.review";
            await session.save();
            await sendReviewMessage(phone, session);
            return;
        }
    }

    // ========================================================================
    //                           INDIVIDUAL FLOW
    // ========================================================================
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
            // requirement: signatory = client_name
            data.authorised_signatory_name = fullName;
            data.user_first_name = first;
            data.user_last_name = last || "";

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
                    "That doesn't look like a valid email.\nPlease enter a *valid Email* (example: name@example.com):"
                );
                return;
            }
            data.user_email = text;

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
                    "Invalid PAN format.\nPAN should be 5 letters, 4 digits, 1 letter (e.g., ABCDE1234F).\n\nPlease enter your *PAN Number* again:"
                );
                return;
            }
            data.pan_no = pan;

            session.state = "signup.ind.gst";
            await session.save();
            await sendQuickReplies(
                phone,
                [
                    { title: "Enter GST", postbackText: "enter_gst" },
                    { title: "Skip", postbackText: "skip_gst" },
                ],
                "If you have a *GST Number*, please enter it now.\nOtherwise, you can *Skip*.",
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
                        "Invalid GST format.\nExample: 22ABCDE1234F1Z5.\n\nPlease enter your *GST Number* again or type *skip*:"
                    );
                    return;
                }
                data.gst_no = gst;
            } else {
                data.gst_no = "";
            }

            session.state = "signup.review";
            await session.save();
            await sendReviewMessage(phone, session);
            return;
        }
    }

    // ========================================================================
    //                                REVIEW
    // ========================================================================
    if (session.state === "signup.review") {
        // Accept numbers or words for options
        if (["1", "confirm", "submit", "confirm & submit"].includes(lower)) {
            await performSubmit(phone, session);
            return;
        }

        if (["2", "restart", "start over"].includes(lower)) {
            // start fresh
            session.state = "signup.chooseType";
            session.signup = { user_type: "", data: {} };
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
            session.state = "awaiting_login_or_signup";
            delete session.signup;
            await session.save();
            await sendMessage(
                phone,
                "Signup cancelled. You can type *signup* anytime to start again."
            );
            return;
        }

        // If something else, just re-show review message
        await sendMessage(
            phone,
            "Please reply with:\n*1* – Confirm & Submit\n*2* – Start Over\n*3* – Cancel"
        );
        return;
    }

    // Fallback: unknown step inside signup flow
    await sendMessage(
        phone,
        "Something went wrong with the signup flow. Please type *signup* to start again."
    );
    session.state = "awaiting_login_or_signup";
    delete session.signup;
    await session.save();
}

// ---------- helper: send review summary ----------
async function sendReviewMessage(phone, session) {
    const { user_type, data } = session.signup;
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

// ---------- helper: perform submit ----------
async function performSubmit(phone, session) {
    const { user_type, data } = session.signup;

    // Basic local check (similar to web validate) :contentReference[oaicite:1]{index=1}
    if (!data.client_name || !data.user_email || !data.client_contact_number || !data.pan_no) {
        await sendMessage(
            phone,
            "Some required fields are missing.\nPlease type *signup* to start again and fill all details."
        );
        session.state = "awaiting_login_or_signup";
        delete session.signup;
        await session.save();
        return;
    }

    if (user_type === "organization" && !data.gst_no) {
        await sendMessage(
            phone,
            "GST Number is required for organizations. Please type *signup* to start again."
        );
        session.state = "awaiting_login_or_signup";
        delete session.signup;
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
            user_type: user_type, // match web code :contentReference[oaicite:2]{index=2}
        };

        console.log("Signup payload being submitted:", payload);

        const apiRes = await signupAPI(payload);

        // Back to login state
        session.state = "awaiting_email";
        delete session.signup;
        await session.save();

        await sendMessage(
            phone,
            "✅ *Signup successful!*\n\nYour onboarding is in process. " +
            "Please check your email for verification.\n\n" +
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

        session.state = "signup.review"; // let user decide again
        await session.save();
    }
}
