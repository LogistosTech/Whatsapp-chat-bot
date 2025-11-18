// helpers/ticketCreateHelper.js
import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import sendListMessage from "../functions/sendListMessage.js";
import createTicketAPI from "../APIS/createTicketAPI.js";
import getMyDetailsAPI from "../APIS/getMyDetailsAPI.js";
import getTicketDetailsAPI from "../APIS/getTicketDetailsAPI.js";

export const TYPES = {
    ndr_related: "NDR Related",
    weight_variance_related: "Weight Variance Related",
    pickup_related: "Pickup Related",
    delivery_related: "Delivery Related",
    passbook_related: "Passbook Related",
    general_complaints: "General Complaints",
};

export const SUBTYPES = {
    request_rto: "Request RTO",
    request_reattempt: "Request Reattempt",
    complaints_related_to_ndr: "Complaints Related to NDR",
    complaints_related_to_weight_variance: "Complaints Related to Weight Variance",
    delay_in_pickup: "Delay in Pickup",
    pickup_other_complaints: "Pickup Other Complaints",
    delay_in_delivery: "Delay in Delivery",
    short_delivery: "Short Delivery",
    delivery_other_complaints: "Delivery Other Complaints",
    lost_shipments: "Lost Shipments",
    damaged_shipments: "Damaged Shipments",
    general_other_complaints: "General Other Complaints",
    payment_is_not_reflecting: "Payment is Not Reflecting",
    balance_related_complaints: "Balance Related Complaints",
    passbook_other_complaints: "Passbook Other Complaints",
};

const TYPE_TO_SUBTYPES = {
    ndr_related: ["request_rto", "request_reattempt", "complaints_related_to_ndr"],
    weight_variance_related: ["complaints_related_to_weight_variance"],
    pickup_related: ["delay_in_pickup", "pickup_other_complaints"],
    delivery_related: ["delay_in_delivery", "short_delivery", "delivery_other_complaints"],
    passbook_related: ["payment_is_not_reflecting", "balance_related_complaints", "passbook_other_complaints"],
    general_complaints: ["lost_shipments", "damaged_shipments", "general_other_complaints"],
};

const SKIP = "skip";

/** Start flow: home screen (Create / Status) */
export const startTicketFlow = async (phone, session) => {
    session.operation = "ticketing";
    session.ticketStatus = "ticket_home";
    session.ticketDraft = {};
    await session.save();

    await sendListMessage(
        phone,
        "Logistos Bot",
        "What would you like to do?",
        [
            { title: "Create Ticket", postbackText: "ticket_create" },
            { title: "Check Ticket Status", postbackText: "ticket_status" },
            { title: "Back", postbackText: "back" },
        ],
        "",
        "Open options"
    );
};

const ensureClientId = async (phone, Session) => {
    let session = await Session.findOne({ phone });
    if (!session?.client_id) {
        try {
            await getMyDetailsAPI(phone);
        } catch {
            /* ignore */
        }
        session = await Session.findOne({ phone });
    }
    return session?.client_id ? Number(session.client_id) : null;
};

const setDraft = async (session, patch) => {
    session.ticketDraft = { ...(session.ticketDraft || {}), ...patch };
    session.markModified && session.markModified("ticketDraft");
    await session.save();
};

const formatTicketDetails = (details, requestedIds) => {
    let list = [];

    let items = [];
    if (Array.isArray(details)) items = details;
    else if (Array.isArray(details?.results)) items = details.results;
    else if (Array.isArray(details?.data)) items = details.data;
    else {
        return (
            "Raw response:\n```" +
            JSON.stringify(details, null, 2).slice(0, 900) +
            "```"
        );
    }

    requestedIds.forEach((id) => {
        const t = items.find((x) => Number(x.id) === Number(id));
        if (!t) {
            list.push(`*Ticket ${id}:* Not found or not accessible.`);
            return;
        }

        const status = t.status || t.current_status || t.ticket_status || "Unknown";
        const subType = t.subtype || t.subtype_key || "";
        const created = t.created_at || t.created_on || "";

        list.push(
            `*Ticket ${t.id}*` +
            `\n• Status: *${status}*` +
            (subType ? `\n• Type: ${subType}` : "") +
            (created ? `\n• Created: ${created}` : "")
        );
    });

    return list.join("\n\n");
};

const ticketCreateHelper = async (phone, msg = "") => {
    const Session = (await import("../models/sessionModel.js")).default;
    let session = await Session.findOne({ phone });
    if (!session) return;

    const text = String(msg || "").trim();
    const lower = text.toLowerCase();

    console.log("=== [TICKET DEBUG] Incoming ===", {
        phone,
        text,
        lower,
        ticketStatus: session.ticketStatus,
        operation: session.operation,
        ticketDraft: session.ticketDraft,
    });

    // global commands
    if (lower === "logout") {
        await sendMessage(phone, "You have been logged out. Type *hi* to log in again.");
        await Session.deleteOne({ phone });
        return;
    }

    if (lower === "restart") {
        session.operation = null;
        session.ticketStatus = null;
        session.ticketDraft = {};
        await session.save();
        return startTicketFlow(phone, session);
    }

    // allow starting status flow from anywhere
    // allow starting status flow from anywhere
    if (["ticket_status", "status", "ticket status", "track ticket"].includes(lower)) {
        console.log("=== [TICKET DEBUG] switching to status_ask_ids ===", {
            prevStatus: session.ticketStatus,
            operation: session.operation,
        });

        session.operation = "ticketing";
        session.ticketStatus = "status_ask_ids";
        session.ticketDraft = {};
        await session.save();

        console.log("=== [TICKET DEBUG] after save ===", {
            ticketStatus: session.ticketStatus,
            operation: session.operation,
        });

        await sendMessage(
            phone,
            "Please send one or more *Ticket IDs* separated by commas.\n\nExample: `296, 9999999, 290`"
        );
        return;
    }

    let st = session.ticketStatus || "ticket_home";

    switch (st) {
        /* ------------------ HOME: Create / Status ------------------ */
        case "ticket_home": {
            if (["ticket_create", "create", "new", "create ticket"].includes(lower)) {
                // go to type selection
                session.ticketStatus = "choose_type";
                session.operation = "ticketing";
                session.ticketDraft = {};
                await session.save();

                const typeOptions = Object.keys(TYPES).map((key) => ({
                    title: TYPES[key],
                    postbackText: key,
                }));

                await sendListMessage(
                    phone,
                    "Logistos Bot",
                    "Choose a category:",
                    typeOptions,
                    "",
                    "Open options"
                );
                return;
            }

            if (
                ["ticket_status", "status", "ticket status", "track ticket"].includes(
                    lower
                )
            ) {
                session.ticketStatus = "status_ask_ids";
                session.operation = "ticketing";
                session.ticketDraft = {};
                await session.save();

                await sendMessage(
                    phone,
                    "Please send one or more *Ticket IDs* separated by commas.\n\nExample: `296, 9999999, 290`"
                );
                return;
            }

            if (["back"].includes(lower)) {
                // go back to your main bot menu (state depends on your app)
                session.operation = null;
                session.ticketStatus = null;
                session.ticketDraft = {};
                await session.save();
                await sendMessage(phone, "Okay, taking you back to the main menu.");
                return;
            }

            // if user sent something else, re-show options
            await sendListMessage(
                phone,
                "Logistos Bot",
                "Please choose an option:",
                [
                    { title: "Create Ticket", postbackText: "ticket_create" },
                    { title: "Check Ticket Status", postbackText: "ticket_status" },
                    { title: "Back", postbackText: "back" },
                ],
                "",
                "Open options"
            );
            return;
        }

        /* ------------------- CREATE TICKET FLOW ------------------- */

        case "choose_type": {
            const validType = Object.keys(TYPES).includes(text);
            if (!validType) {
                const options = Object.keys(TYPES).map((key) => ({
                    title: TYPES[key],
                    postbackText: key,
                }));
                await sendListMessage(
                    phone,
                    "Logistos Bot",
                    "Please pick a valid category:",
                    options,
                    "",
                    "Open options"
                );
                return;
            }
            await setDraft(session, { type_key: text });
            session.ticketStatus = "choose_subtype";
            await session.save();

            const keys = TYPE_TO_SUBTYPES[text] || [];
            const opts = keys.map((k) => ({
                title: SUBTYPES[k],
                postbackText: k,
            }));
            await sendListMessage(
                phone,
                "Logistos Bot",
                `Choose a subcategory for ${TYPES[text]}:`,
                opts,
                "",
                "Open options"
            );
            return;
        }

        case "choose_subtype": {
            const valid = Object.prototype.hasOwnProperty.call(SUBTYPES, text);
            if (!valid) {
                const keys = TYPE_TO_SUBTYPES[session.ticketDraft?.type_key] || [];
                const opts = keys.map((k) => ({
                    title: SUBTYPES[k],
                    postbackText: k,
                }));
                await sendListMessage(
                    phone,
                    "Logistos Bot",
                    "Pick a subcategory:",
                    opts,
                    "",
                    "Open options"
                );
                return;
            }
            await setDraft(session, { subtype_key: text });
            session.ticketStatus = "need_shipment";
            await session.save();
            return sendMessage(phone, "Enter shipment #:");
        }

        case "need_shipment": {
            if (!text)
                return sendMessage(phone, "Shipment # is required. Please enter it:");
            await setDraft(session, { shipment_id: text });
            session.ticketStatus = "need_awb";
            await session.save();

            await sendQuickReplies(
                phone,
                [{ title: "Skip", postbackText: SKIP }],
                "Enter tracking code (or tap Skip):",
                "Logistos Bot",
                ""
            );
            return;
        }

        case "need_awb": {
            if (lower !== SKIP) {
                await setDraft(session, { awb: text });
            } else {
                await setDraft(session, { awb: undefined });
            }
            session.ticketStatus = "need_details";
            await session.save();
            return sendMessage(phone, "Add a brief description (optional):");
        }

        case "need_details": {
            const note = text || "";
            await setDraft(session, { note });

            const client_id = await ensureClientId(phone, Session);
            if (!client_id) {
                await sendMessage(
                    phone,
                    "Your account isn’t linked yet. Please type *hi* and login again."
                );
                session.operation = null;
                session.ticketStatus = null;
                await session.save();
                return;
            }

            const { type_key, subtype_key, shipment_id, awb } =
                session.ticketDraft || {};

            if (!type_key) {
                await sendMessage(
                    phone,
                    "Category missing. Type *restart* to begin again."
                );
                return;
            }
            if (!subtype_key) {
                await sendMessage(
                    phone,
                    "Subcategory missing. Type *restart* to begin again."
                );
                return;
            }
            if (!shipment_id) {
                await sendMessage(
                    phone,
                    "Shipment # missing. Type *restart* to begin again."
                );
                return;
            }

            const payload = {
                client_id,
                subtype_key,
                shipment_id: String(shipment_id),
                ...(awb ? { awb: String(awb) } : {}),
                details: { note },
            };

            console.log("🧾 Ticket payload:", payload);

            try {
                const resp = await createTicketAPI(phone, payload);

                session.operation = null;
                session.ticketStatus = "done";
                session.ticketDraft = {};
                await session.save();

                const id = resp?.id ?? resp?.ticket_id ?? "N/A";
                await sendMessage(phone, `✅ Ticket created.\nID: *${id}*`);

                await sendListMessage(
                    phone,
                    "Logistos Bot",
                    "What next?",
                    [
                        { title: "Create Another Ticket", postbackText: "ticket_create" },
                        { title: "Check Ticket Status", postbackText: "ticket_status" },
                        { title: "Track an Order", postbackText: "track" },
                        { title: "Logout", postbackText: "logout" },
                    ],
                    "",
                    "Open menu"
                );
            } catch (err) {
                console.error(
                    "❌ Ticket create error:",
                    err?.response?.data || err?.message || err
                );
                session.ticketStatus = "need_details";
                await session.save();
                await sendMessage(
                    phone,
                    "Couldn’t create it now. Try again or type *restart*."
                );
            }
            return;
        }

        /* ------------------- TICKET STATUS FLOW ------------------- */

        case "status_ask_ids": {
            console.log("=== [TICKET DEBUG] in status_ask_ids ===", {
                phone,
                text,
                ticketStatus: session.ticketStatus,
            });

            const parts = text
                .split(/[,\s]+/)
                .map((x) => x.trim())
                .filter(Boolean);
            const ids = parts
                .map((p) => Number(p))
                .filter((n) => Number.isFinite(n) && n > 0);

            console.log("=== [TICKET DEBUG] parsed IDs ===", ids);

            if (!ids.length) {
                await sendMessage(
                    phone,
                    "Please send one or more *numeric Ticket IDs* separated by commas.\n\nExample: `69, 99, 1769`"
                );
                return;
            }

            try {
                console.log("=== [TICKET DEBUG] calling getTicketDetailsAPI ===", {
                    phone,
                    ids,
                });
                const details = await getTicketDetailsAPI(phone, ids);
                console.log("=== [TICKET DEBUG] API response ===", details);

                const formatted = formatTicketDetails(details, ids);

                await sendMessage(phone, formatted);

                session.ticketStatus = "status_done";
                await session.save();

                await sendListMessage(
                    phone,
                    "Logistos Bot",
                    "Anything else?",
                    [
                        { title: "Create a Ticket", postbackText: "ticket_create" },
                        { title: "Check Another Ticket", postbackText: "ticket_status" },
                        { title: "Track an Order", postbackText: "track" },
                        { title: "Logout", postbackText: "logout" },
                    ],
                    "",
                    "Open menu"
                );
            } catch (err) {
                console.error(
                    "❌ Ticket status error:",
                    err?.response?.data || err?.message || err
                );
                await sendMessage(
                    phone,
                    "Couldn’t fetch ticket status right now. Please try again later or check from the web portal."
                );
                session.ticketStatus = "status_ask_ids";
                await session.save();
            }
            return;
        }

        case "status_done": {
            if (["ticket_create", "ticket", "create", "new ticket"].includes(lower)) {
                session.ticketStatus = "choose_type";
                session.operation = "ticketing";
                session.ticketDraft = {};
                await session.save();
                return startTicketFlow(phone, session);
            }
            if (
                ["ticket_status", "status", "ticket status", "track ticket"].includes(
                    lower
                )
            ) {
                session.ticketStatus = "status_ask_ids";
                session.operation = "ticketing";
                await session.save();
                await sendMessage(
                    phone,
                    "Please send one or more *Ticket IDs* separated by commas.\n\nExample: `296, 9999999, 290`"
                );
                return;
            }
            // default: show small menu again
            await sendListMessage(
                phone,
                "Logistos Bot",
                "Anything else?",
                [
                    { title: "Create a Ticket", postbackText: "ticket_create" },
                    { title: "Check Another Ticket", postbackText: "ticket_status" },
                    { title: "Track an Order", postbackText: "track" },
                    { title: "Logout", postbackText: "logout" },
                ],
                "",
                "Open menu"
            );
            return;
        }

        /* --------------------- FALLBACK / RESET -------------------- */

        case "done":
        default: {
            // go back to ticket home
            session.ticketStatus = "ticket_home";
            session.operation = "ticketing";
            session.ticketDraft = {};
            await session.save();
            return startTicketFlow(phone, session);
        }
    }
};

export default ticketCreateHelper;
