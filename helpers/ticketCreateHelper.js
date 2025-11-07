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
    // NDR
    request_rto: "Request RTO",
    request_reattempt: "Request Reattempt",
    complaints_related_to_ndr: "Complaints Related to NDR",
    // Weight variance
    complaints_related_to_weight_variance: "Complaints Related to Weight Variance",
    // Pickup
    delay_in_pickup: "Delay in Pickup",
    pickup_other_complaints: "Pickup Other Complaints",
    // Delivery
    delay_in_delivery: "Delay in Delivery",
    short_delivery: "Short Delivery",
    delivery_other_complaints: "Delivery Other Complaints",
    // General
    lost_shipments: "Lost Shipments",
    damaged_shipments: "Damaged Shipments",
    general_other_complaints: "General Other Complaints",
    // Passbook
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

export const startTicketFlow = async (phone, session) => {
    session.operation = "ticketing";
    session.ticketStatus = "choose_type";
    session.ticketDraft = {};
    await session.save();

    // more than 3 → use list
    const typeOptions = [
        ...Object.keys(TYPES).map(key => ({ title: TYPES[key], postbackText: key })),
        { title: "Skip", postbackText: SKIP },
    ];

    await sendListMessage(
        phone,
        "Logistos Bot",
        "Choose a category (or Skip):",
        typeOptions,
        "You can skip this step",
        "Open options"
    );
};

const toLabel = (key, map) => map[key] || key.replace(/_/g, " ");

const ensureClientId = async (phone, Session) => {
    let session = await Session.findOne({ phone });
    if (!session?.client_id) {
        try { await getMyDetailsAPI(phone); } catch { }
        session = await Session.findOne({ phone });
    }
    return session?.client_id ? Number(session.client_id) : null;
};

const ticketCreateHelper = async (phone, msg = "") => {
    const Session = (await import("../models/sessionModel.js")).default;
    let session = await Session.findOne({ phone });

    if (!session) return; // shouldn't happen

    // normalize text
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

    // default state
    let st = session.ticketStatus || "choose_type";
    session.ticketDraft = session.ticketDraft || {};

    switch (st) {
        case "choose_type": {
            // accept a valid type key OR skip
            const allTypes = Object.keys(TYPES);
            if (text === SKIP || !allTypes.includes(text)) {
                session.ticketDraft.type_key = null;
            } else {
                session.ticketDraft.type_key = text;
            }

            session.ticketStatus = "choose_subtype";
            await session.save();

            // Build subtype list:
            let subtypeKeys = session.ticketDraft.type_key
                ? TYPE_TO_SUBTYPES[session.ticketDraft.type_key] || []
                : Object.keys(SUBTYPES); // if type skipped, show all

            // ensure we don't exceed 10
            const options = subtypeKeys.slice(0, 10).map(k => ({ title: SUBTYPES[k], postbackText: k }));
            options.push({ title: "Skip", postbackText: SKIP });

            await sendListMessage(
                phone,
                "Logistos Bot",
                session.ticketDraft.type_key
                    ? `Choose a subcategory for ${toLabel(session.ticketDraft.type_key, TYPES)} (or Skip):`
                    : "Choose a subcategory (or Skip):",
                options,
                "You can skip this step",
                "Open options"
            );
            return;
        }

        case "choose_subtype": {
            // accept valid subtype OR skip
            const allSubtypes = Object.keys(SUBTYPES);
            if (text !== SKIP && allSubtypes.includes(text)) {
                session.ticketDraft.subtype_key = text; // string
            } else {
                session.ticketDraft.subtype_key = null;
            }

            session.ticketStatus = "need_shipment";
            await session.save();
            return sendMessage(phone, "Enter shipment # (or type Skip):");
        }

        case "need_shipment": {
            if (lower !== SKIP) {
                // accept any non-empty – API accepts string; let server validate existence
                if (!text) return sendMessage(phone, "Please enter a value or type Skip:");
                session.ticketDraft.shipment_id = text; // keep as string
            } else {
                session.ticketDraft.shipment_id = undefined;
            }

            session.ticketStatus = "need_awb";
            await session.save();
            return sendMessage(phone, "Enter tracking code (or type Skip):");
        }

        case "need_awb": {
            if (lower !== SKIP) {
                if (!text) return sendMessage(phone, "Please enter a value or type Skip:");
                session.ticketDraft.awb = text; // string
            } else {
                session.ticketDraft.awb = undefined;
            }

            session.ticketStatus = "need_details";
            await session.save();
            return sendMessage(phone, "Add a brief description:");
        }

        case "need_details": {
            if (!text) return sendMessage(phone, "A short description helps. Please add it:");
            session.ticketDraft.note = text;

            // make sure we have client_id
            const client_id = await ensureClientId(phone, Session);
            if (!client_id) {
                await sendMessage(phone, "Your account isn’t linked yet. Please type *hi* and login again.");
                session.operation = null;
                session.ticketStatus = null;
                await session.save();
                return;
            }

            // build payload — strings for shipment_id & awb
            const { type_key, subtype_key, shipment_id, awb, note } = session.ticketDraft;

            const payload = {
                client_id,
                ...(subtype_key ? { subtype_key } : {}),         // optional
                ...(shipment_id ? { shipment_id: String(shipment_id) } : {}),
                ...(awb ? { awb: String(awb) } : {}),
                details: { note },
            };

            // log final payload for debugging
            console.log("🧾 Ticket payload:", payload);

            try {
                const resp = await createTicketAPI(phone, payload);

                // reset
                session.operation = null;
                session.ticketStatus = "done";
                session.ticketDraft = {};
                await session.save();

                const id = resp?.id ?? resp?.ticket_id ?? "N/A";
                await sendMessage(phone, `Created.\nID: ${id}`);

                // 4 items → use list
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
                    "Choose",
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
