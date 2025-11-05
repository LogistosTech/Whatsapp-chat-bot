// helpers/ticketCreateHelper.js
import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import createTicketAPI from "../APIS/createTicketAPI.js";

export const SUBTYPES = {
    // NDR
    REQUEST_RTO: "request_rto",
    REQUEST_REATTEMPT: "request_reattempt",
    COMPLAINTS_RELATED_TO_NDR: "complaints_related_to_ndr",
    // Weight variance
    COMPLAINTS_RELATED_TO_WEIGHT_VARIANCE: "complaints_related_to_weight_variance",
    // Pickup
    DELAY_IN_PICKUP: "delay_in_pickup",
    PICKUP_OTHER_COMPLAINTS: "pickup_other_complaints",
    // Delivery
    DELAY_IN_DELIVERY: "delay_in_delivery",
    SHORT_DELIVERY: "short_delivery",
    DELIVERY_OTHER_COMPLAINTS: "delivery_other_complaints",
    // General
    LOST_SHIPMENTS: "lost_shipments",
    DAMAGED_SHIPMENTS: "damaged_shipments",
    GENERAL_OTHER_COMPLAINTS: "general_other_complaints",
    // Passbook
    PAYMENT_IS_NOT_REFLECTING: "payment_is_not_reflecting",
    BALANCE_RELATED_COMPLAINTS: "balance_related_complaints",
    PASSBOOK_OTHER_COMPLAINTS: "passbook_other_complaints",
};

// Which choices need shipment context?
const NEEDS_SHIPMENT = new Set([
    SUBTYPES.REQUEST_RTO,
    SUBTYPES.REQUEST_REATTEMPT,
    SUBTYPES.COMPLAINTS_RELATED_TO_NDR,
    SUBTYPES.DELAY_IN_DELIVERY,
    SUBTYPES.SHORT_DELIVERY,
    SUBTYPES.DELIVERY_OTHER_COMPLAINTS,
    SUBTYPES.DELAY_IN_PICKUP,
    SUBTYPES.PICKUP_OTHER_COMPLAINTS,
    SUBTYPES.COMPLAINTS_RELATED_TO_WEIGHT_VARIANCE,
    SUBTYPES.LOST_SHIPMENTS,
    SUBTYPES.DAMAGED_SHIPMENTS,
]);

// Subtype options shown as quick replies (payloads are machine-safe keys)
const SUBTYPE_OPTIONS = [
    { title: "Delay in delivery", payload: SUBTYPES.DELAY_IN_DELIVERY },
    { title: "Short delivery", payload: SUBTYPES.SHORT_DELIVERY },
    { title: "Reattempt", payload: SUBTYPES.REQUEST_REATTEMPT },
    { title: "RTO", payload: SUBTYPES.REQUEST_RTO },
    { title: "Pickup delay", payload: SUBTYPES.DELAY_IN_PICKUP },
    { title: "Weight variance", payload: SUBTYPES.COMPLAINTS_RELATED_TO_WEIGHT_VARIANCE },
    { title: "Lost shipment", payload: SUBTYPES.LOST_SHIPMENTS },
    { title: "Damaged shipment", payload: SUBTYPES.DAMAGED_SHIPMENTS },
    { title: "Passbook issue", payload: SUBTYPES.PAYMENT_IS_NOT_REFLECTING },
    { title: "General issue", payload: SUBTYPES.GENERAL_OTHER_COMPLAINTS },
];

/**
 * Entry point: starts the flow.
 */
export const startTicketFlow = async (phone, session) => {
    session.operation = "ticketing";
    session.ticketStatus = "choose_subtype";
    session.ticketDraft = {};
    await session.save();

    return sendQuickReplies(
        phone,
        SUBTYPE_OPTIONS.map((o) => ({ title: o.title, postbackText: o.payload })),
        "Choose one:",
        "Logistos Bot",
        "Options"
    );
};

/**
 * Handler for the conversation state machine (mirrors your trackOrderHelper pattern).
 */
const ticketCreateHelper = async (phone, msg = "") => {
    // load session
    const Session = (await import("../models/sessionModel.js")).default;
    let session = await Session.findOne({ phone });

    // On first hit, align operation
    if (session.operation === null || session.operation === "booking" || session.operation === "tracking") {
        session.operation = "ticketing";
        await session.save();
    }

    // Basic command hooks
    const lower = (msg || "").toLowerCase();
    if (lower === "logout") {
        await sendMessage(phone, "You have been logged out. Type *hi* to log in again.");
        await Session.deleteOne({ phone });
        return;
    }
    if (lower === "restart") {
        session.operation = null;
        session.ticketStatus = "choose_subtype";
        session.ticketDraft = {};
        await session.save();
        return startTicketFlow(phone, session);
    }

    // Ensure status
    let st = session.ticketStatus || "choose_subtype";

    switch (st) {
        case "choose_subtype": {
            // Expect a subtype key from buttons
            const chosen = msg?.trim();
            const valid = Object.values(SUBTYPES).includes(chosen);
            if (!valid) {
                return startTicketFlow(phone, session);
            }

            session.ticketDraft = { subtype_key: chosen };
            if (NEEDS_SHIPMENT.has(chosen)) {
                session.ticketStatus = "need_shipment";
                await session.save();
                return sendMessage(phone, "Enter shipment #:");
            } else {
                session.ticketStatus = "need_details";
                await session.save();
                return sendMessage(phone, "Add a brief description:");
            }
        }

        case "need_shipment": {
            const shipment = String(msg || "").trim();
            if (!/^\d+$/.test(shipment)) {
                return sendMessage(phone, "Enter a valid number:");
            }
            session.ticketDraft.shipment_id = shipment;
            session.ticketStatus = "need_code";
            await session.save();
            // Avoid the term you asked not to include; use a neutral label
            return sendMessage(phone, "Enter tracking code:");
        }

        case "need_code": {
            const code = String(msg || "").trim();
            if (!code) {
                return sendMessage(phone, "Please re-enter:");
            }
            session.ticketDraft.awb = code;
            session.ticketStatus = "need_details";
            await session.save();
            return sendMessage(phone, "Add a brief description:");
        }

        case "need_details": {
            const note = String(msg || "").trim();
            if (!note) {
                return sendMessage(phone, "A short description helps. Please add it:");
            }

            const { client_id } = session; // should already be set during login details fetch
            const { subtype_key, shipment_id, awb } = session.ticketDraft || {};
            const payload = {
                client_id,
                subtype_key,
                ...(shipment_id ? { shipment_id } : {}),
                ...(awb ? { awb } : {}),
                details: { note },
            };

            try {
                const resp = await createTicketAPI(phone, payload);

                // Reset to authenticated menu
                session.operation = null;
                session.ticketStatus = "done";
                session.ticketDraft = {};
                await session.save();

                const id = resp?.id ?? resp?.ticket_id ?? "N/A";
                await sendMessage(phone, `Created.\nID: ${id}`);
                // Offer next steps
                await sendQuickReplies(
                    phone,
                    [
                        { title: "Book a Shipment", postbackText: "book" },
                        { title: "Track an Order", postbackText: "track" },
                        { title: "Create Another", postbackText: "ticket" },
                        { title: "Logout", postbackText: "logout" },
                    ],
                    "What next?",
                    "Logistos Bot",
                    "Choose"
                );
            } catch (err) {
                console.error("❌ Ticket create error:", err?.message || err);
                // keep draft so user can retry the details step
                session.ticketStatus = "need_details";
                await session.save();
                await sendMessage(phone, "Couldn’t create it now. Try again or type *restart*.");
            }
            return;
        }

        case "done":
        default: {
            // restart lightweight
            session.ticketStatus = "choose_subtype";
            session.operation = "ticketing";
            session.ticketDraft = {};
            await session.save();
            return startTicketFlow(phone, session);
        }
    }
};

export default ticketCreateHelper;
