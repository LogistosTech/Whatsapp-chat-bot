import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import sendListMessage from "../functions/sendListMessage.js";
import createTicketAPI from "../APIS/createTicketAPI.js";
import getMyDetailsAPI from "../APIS/getMyDetailsAPI.js";

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

const SKIP = "skip"; // allowed only for AWB (and note can be blank)

/** Start flow: choose TYPE (required) */
export const startTicketFlow = async (phone, session) => {
    session.operation = "ticketing";
    session.ticketStatus = "choose_type";
    session.ticketDraft = {};
    await session.save();

    const typeOptions = Object.keys(TYPES).map(key => ({ title: TYPES[key], postbackText: key }));

    // >3 items -> list
    await sendListMessage(
        phone,
        "Logistos Bot",
        "Choose a category:",
        typeOptions,
        "",
        "Open options"
    );
};

const ensureClientId = async (phone, Session) => {
    let session = await Session.findOne({ phone });
    if (!session?.client_id) {
        try { await getMyDetailsAPI(phone); } catch { }
        session = await Session.findOne({ phone });
    }
    return session?.client_id ? Number(session.client_id) : null;
};

const setDraft = async (session, patch) => {
    session.ticketDraft = { ...(session.ticketDraft || {}), ...patch };
    session.markModified && session.markModified("ticketDraft");
    await session.save();
};

const ticketCreateHelper = async (phone, msg = "") => {
    const Session = (await import("../models/sessionModel.js")).default;
    let session = await Session.findOne({ phone });
    if (!session) return;

    const text = String(msg || "").trim();
    const lower = text.toLowerCase();

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

    let st = session.ticketStatus || "choose_type";

    switch (st) {
        case "choose_type": {
            const validType = Object.keys(TYPES).includes(text);
            if (!validType) {
                // re-prompt
                const options = Object.keys(TYPES).map(key => ({ title: TYPES[key], postbackText: key }));
                await sendListMessage(phone, "Logistos Bot", "Please pick a valid category:", options, "", "Open options");
                return;
            }
            await setDraft(session, { type_key: text });
            session.ticketStatus = "choose_subtype";
            await session.save();

            const keys = TYPE_TO_SUBTYPES[text] || [];
            const opts = keys.map(k => ({ title: SUBTYPES[k], postbackText: k }));
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
                const opts = keys.map(k => ({ title: SUBTYPES[k], postbackText: k }));
                await sendListMessage(phone, "Logistos Bot", "Pick a subcategory:", opts, "", "Open options");
                return;
            }
            await setDraft(session, { subtype_key: text });
            session.ticketStatus = "need_shipment";
            await session.save();
            return sendMessage(phone, "Enter shipment #:");
        }

        case "need_shipment": {
            if (!text) return sendMessage(phone, "Shipment # is required. Please enter it:");
            await setDraft(session, { shipment_id: text }); // keep string
            session.ticketStatus = "need_awb";
            await session.save();

            // AWB is optional -> allow Skip
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
                await setDraft(session, { awb: text }); // can be any string
            } else {
                await setDraft(session, { awb: undefined });
            }
            session.ticketStatus = "need_details";
            await session.save();
            return sendMessage(phone, "Add a brief description (optional):");
        }

        case "need_details": {
            // Note is optional
            const note = text || "";
            await setDraft(session, { note });

            const client_id = await ensureClientId(phone, Session);
            if (!client_id) {
                await sendMessage(phone, "Your account isn’t linked yet. Please type *hi* and login again.");
                session.operation = null;
                session.ticketStatus = null;
                await session.save();
                return;
            }

            const { type_key, subtype_key, shipment_id, awb } = session.ticketDraft || {};

            // Hard validations (as requested): type, subtype, shipment_id are REQUIRED
            if (!type_key) { await sendMessage(phone, "Category missing. Type *restart* to begin again."); return; }
            if (!subtype_key) { await sendMessage(phone, "Subcategory missing. Type *restart* to begin again."); return; }
            if (!shipment_id) { await sendMessage(phone, "Shipment # missing. Type *restart* to begin again."); return; }

            const payload = {
                client_id,
                subtype_key,
                shipment_id: String(shipment_id),
                ...(awb ? { awb: String(awb) } : {}),
                details: { note }, // may be empty
            };

            console.log("🧾 Ticket payload:", payload);

            try {
                const resp = await createTicketAPI(phone, payload);

                // Reset flow
                session.operation = null;
                session.ticketStatus = "done";
                session.ticketDraft = {};
                await session.save();

                const id = resp?.id ?? resp?.ticket_id ?? "N/A";
                await sendMessage(phone, `Created.\nID: ${id}`);

                await sendListMessage(
                    phone,
                    "Logistos Bot",
                    "What next?",
                    [
                        { title: "Book a Shipment", postbackText: "book" },
                        { title: "Track an Order", postbackText: "track" },
                        { title: "Create Another", postbackText: "ticket" },
                        { title: "Logout", postbackText: "logout" },
                    ],
                    "",
                    "Open menu"
                );
            } catch (err) {
                console.error("❌ Ticket create error:", err?.response?.data || err?.message || err);
                session.ticketStatus = "need_details";
                await session.save();
                await sendMessage(phone, "Couldn’t create it now. Try again or type *restart*.");
            }
            return;
        }

        case "done":
        default: {
            session.ticketStatus = "choose_type";
            session.operation = "ticketing";
            session.ticketDraft = {};
            await session.save();
            return startTicketFlow(phone, session);
        }
    }
};

export default ticketCreateHelper;
