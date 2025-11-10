// helpers/rateCalcHelper.js — strict, button-driven, no loops
import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import { getRatesAPI, getPincodeAPI } from "../APIS/getRatesAPI.js";

const COURIER_TYPES = [
    { title: "B2B", postbackText: "B2B" },
    { title: "B2C", postbackText: "B2C" },
];

const MODES = [
    { title: "Surface", postbackText: "surface" },
    { title: "Air", postbackText: "air" },
    { title: "Railway", postbackText: "railway" },
];

const DIM_UNITS = [
    { title: "CM", postbackText: "CM" },
    { title: "IN", postbackText: "IN" },
];

const PAY_TYPES = [
    { title: "Prepaid", postbackText: "0" },
    { title: "COD", postbackText: "1" },
    { title: "TO-PAY", postbackText: "2" },
];

// ---------- helpers ----------
const saveDraft = async (session, d) => {
    session.rateDraft = d;
    session.markModified("rateDraft");
    await session.save();
};

const parseDims = (input) => {
    const nums = String(input)
        .replace(/[^\d.\s, x*]/gi, "")
        .replace(/[x*]/gi, " ")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
    if (nums.length < 3 || nums.some(isNaN)) return null;
    const [length, width, height] = nums;
    return { length, width, height };
};

const nextMissing = (d) => {
    if (!/^\d{6}$/.test(String(d.pickup_pin || ""))) return { s: "pickup_pin", p: "Enter *Origin Pincode*:" };
    if (!/^\d{6}$/.test(String(d.drop_pin || ""))) return { s: "drop_pin", p: "Enter *Destination Pincode*:" };
    if (!d.courier_type) return { s: "courier_type", p: "Select *Courier Type*:" };
    if (!d.mode_name) return { s: "mode", p: "Select *Mode*:" };
    if (d.courier_type === "B2B" && !d.units) return { s: "units", p: "Enter *Box Count* (e.g., 1, 2, 3):" };
    if (!d.weight) return { s: "weight", p: "Enter *Weight per Box in KG* (e.g., 5):" };
    if (!d.unit) return { s: "dimension", p: "Select *Dimension Unit* for L×W×H:" };
    if (!d.length || !d.width || !d.height) return { s: "dims", p: "Send *Length x Width x Height* (e.g., 30x20x15):" };
    if (typeof d.invoice_value !== "number") return { s: "invoice", p: "Enter *Declared Value (₹)*:" };
    if (d.shipment_payment_type == null) return { s: "paytype", p: "Select *Payment Type*:" };
    if ((d.shipment_payment_type === "1" || d.shipment_payment_type === "2") && !Number.isFinite(+d.shipment_payment_amount)) {
        return { s: "payamount", p: `Enter *${d.shipment_payment_type === "1" ? "COD" : "TO-PAY"} Amount (₹)*:` };
    }
    return null;
};

const buildPayload = async (phone, d) => {
    const from = await getPincodeAPI(phone, d.pickup_pin);
    const to = await getPincodeAPI(phone, d.drop_pin);

    const units = d.courier_type === "B2C" ? 1 : Math.max(1, d.units | 0);
    const perBoxW = +d.weight;

    const toCM = d.unit === "IN" ? (n) => +(n * 2.54).toFixed(2) : (n) => +n;

    const payload = {
        pickup_pin: String(d.pickup_pin).trim(),
        mode_name: d.mode_name, // "surface"|"air"|"railway"
        from_city: from.city || "",
        from_state: from.state || "",
        drop_pin: String(d.drop_pin).trim(),
        to_city: to.city || "",
        to_state: to.state || "",
        quantity: units,
        weight: +(units * perBoxW).toFixed(2), // total chargeable weight before volumetric
        invoice_value: +d.invoice_value || 0,
        mps_details: [
            {
                units,
                weight: perBoxW,
                length: toCM(+d.length || 0),
                width: toCM(+d.width || 0),
                height: toCM(+d.height || 0),
                unit: "CM",
            },
        ],
        shipment_payment_type: String(d.shipment_payment_type ?? "0"),
        is_to_pay: String(d.shipment_payment_type) === "2",
        is_cod: String(d.shipment_payment_type) === "1",
        ...(String(d.shipment_payment_type) !== "0" && Number.isFinite(+d.shipment_payment_amount)
            ? { shipment_payment_amount: +d.shipment_payment_amount }
            : {}),
        ...(String(d.shipment_payment_type) === "1" && Number.isFinite(+d.shipment_payment_amount)
            ? { cod_amount: +d.shipment_payment_amount }
            : {}),
        rov_mode: "rov_owner",
        special_delivery_type: "",
        courier_type: d.courier_type === "B2B" ? "B2B" : "B2C",
        self_drop: false,
        is_abd_scheduled: false,
    };

    // Final sanity
    if (!/^\d{6}$/.test(payload.pickup_pin) || !/^\d{6}$/.test(payload.drop_pin)) throw new Error("Invalid pincode");
    if (!["surface", "air", "railway"].includes(payload.mode_name)) throw new Error("Invalid mode");
    if (!(+perBoxW > 0)) throw new Error("Invalid weight");

    return payload;
};

// ---------- public: start flow ----------
export async function startRateFlow(phone, session) {
    session.operation = "ratecalc";
    session.rateStatus = "pickup_pin";
    session.rateDraft = {};
    await session.save();
    await sendMessage(phone, "Enter *Origin Pincode*:");
}

// ---------- main handler ----------
export default async function rateCalcHelper(phone, msg = "") {
    const Session = (await import("../models/sessionModel.js")).default;
    let session = await Session.findOne({ phone });
    if (!session) return;

    session.operation ||= "ratecalc";
    session.rateDraft ||= {};
    session.rateStatus ||= "pickup_pin";

    const d = session.rateDraft;
    const raw = String(msg || "").trim();
    const lower = raw.toLowerCase();
    let st = session.rateStatus;

    // Universal controls
    if (lower === "restart" || lower === "rate") {
        session.operation = "ratecalc";
        session.rateStatus = "pickup_pin";
        session.rateDraft = {};
        await session.save();
        return sendMessage(phone, "Enter *Origin Pincode*:");
    }

    // STATE MACHINE
    switch (st) {
        case "pickup_pin": {
            if (!/^\d{6}$/.test(raw)) return sendMessage(phone, "Please enter a valid 6-digit *Origin Pincode*:");
            d.pickup_pin = raw;
            session.rateStatus = "drop_pin";
            await saveDraft(session, d);
            return sendMessage(phone, "Enter *Destination Pincode*:");
        }

        case "drop_pin": {
            if (!/^\d{6}$/.test(raw)) return sendMessage(phone, "Please enter a valid 6-digit *Destination Pincode*:");
            d.drop_pin = raw;
            session.rateStatus = "courier_type";
            await saveDraft(session, d);
            return sendQuickReplies(phone, COURIER_TYPES, "Select *Courier Type*:");
        }

        case "courier_type": {
            // Only buttons B2B/B2C are accepted; free-text => re-show buttons
            if (!["b2b", "b2c"].includes(lower)) {
                return sendQuickReplies(phone, COURIER_TYPES, "Please choose *B2B* or *B2C*:");
            }
            d.courier_type = lower === "b2b" ? "B2B" : "B2C";
            session.rateStatus = "mode";
            await saveDraft(session, d);
            return sendQuickReplies(phone, MODES, "Select *Mode*:");
        }

        case "mode": {
            // Only buttons Surface/Air/Railway; any other text => re-show
            if (!["surface", "air", "railway"].includes(lower)) {
                return sendQuickReplies(phone, MODES, "Please pick a *Mode*:");
            }
            d.mode_name = lower;
            // For B2C we don't ask units; it's always 1
            if (d.courier_type === "B2C") {
                d.units = 1;
                session.rateStatus = "weight";
                await saveDraft(session, d);
                return sendMessage(phone, "Enter *Weight per Box in KG* (max 30 for B2C):");
            }
            // B2B → ask for units
            session.rateStatus = "units";
            await saveDraft(session, d);
            return sendMessage(phone, "Enter *Box Count* (e.g., 1, 2, 3):");
        }

        case "units": {
            const units = Number(raw);
            if (!Number.isFinite(units) || units <= 0) {
                return sendMessage(phone, "Enter a valid *Box Count*:");
            }
            d.units = Math.max(1, units | 0);
            session.rateStatus = "weight";
            await saveDraft(session, d);
            return sendMessage(phone, "Enter *Weight per Box in KG* (e.g., 5):");
        }

        case "weight": {
            const w = Number(raw);
            if (!Number.isFinite(w) || w <= 0) {
                return sendMessage(phone, "Enter a valid *weight in KG*:");
            }
            if (d.courier_type === "B2C" && w > 30) {
                return sendMessage(phone, "B2C limit is *30 KG per box*. Enter ≤ 30 KG, or type *restart* and choose B2B.");
            }
            d.weight = w;
            session.rateStatus = "dimension";
            await saveDraft(session, d);
            return sendQuickReplies(phone, DIM_UNITS, "Select *Dimension Unit* for L×W×H:");
        }

        case "dimension": {
            if (!["cm", "in"].includes(lower)) {
                return sendQuickReplies(phone, DIM_UNITS, "Please pick *CM* or *IN*:");
            }
            d.unit = lower.toUpperCase(); // "CM" | "IN"
            session.rateStatus = "dims";
            await saveDraft(session, d);
            return sendMessage(phone, "Send *Length x Width x Height* (e.g., 30x20x15):");
        }

        case "dims": {
            const dims = parseDims(raw);
            if (!dims) return sendMessage(phone, "Couldn't read that. Send like *30x20x15* (or 30,20,15)");
            d.length = dims.length;
            d.width = dims.width;
            d.height = dims.height;
            session.rateStatus = "invoice";
            await saveDraft(session, d);
            return sendMessage(phone, "Enter *Declared Value (₹)*:");
        }

        case "invoice": {
            const inv = Number(raw);
            if (!Number.isFinite(inv) || inv < 0) return sendMessage(phone, "Enter a valid *amount* (₹):");
            d.invoice_value = inv;
            session.rateStatus = "paytype";
            await saveDraft(session, d);
            return sendQuickReplies(phone, PAY_TYPES, "Select *Payment Type*:");
        }

        case "paytype": {
            if (!["0", "1", "2", "prepaid", "cod", "to-pay", "to pay"].includes(lower)) {
                return sendQuickReplies(phone, PAY_TYPES, "Pick *Prepaid*, *COD*, or *TO-PAY*:");
            }
            const map = { prepaid: "0", cod: "1", "to-pay": "2", "to pay": "2" };
            d.shipment_payment_type = ["0", "1", "2"].includes(lower) ? lower : map[lower];
            if (d.shipment_payment_type === "1" || d.shipment_payment_type === "2") {
                session.rateStatus = "payamount";
                await saveDraft(session, d);
                return sendMessage(phone, `Enter *${d.shipment_payment_type === "1" ? "COD" : "TO-PAY"} Amount (₹)*:`);
            }
            session.rateStatus = "confirm";
            await saveDraft(session, d);
            return sendQuickReplies(
                phone,
                [{ title: "OK", postbackText: "OK" }, { title: "Restart", postbackText: "restart" }],
                "All set. Tap *OK* to calculate rates."
            );
        }

        case "payamount": {
            const amt = Number(raw);
            if (!Number.isFinite(amt) || amt < 0) return sendMessage(phone, "Enter a valid amount (₹):");
            d.shipment_payment_amount = amt;
            session.rateStatus = "confirm";
            await saveDraft(session, d);
            return sendQuickReplies(
                phone,
                [{ title: "OK", postbackText: "OK" }, { title: "Restart", postbackText: "restart" }],
                "All set. Tap *OK* to calculate rates."
            );
        }

        case "confirm": {
            if (lower !== "ok") {
                return sendQuickReplies(
                    phone,
                    [{ title: "OK", postbackText: "OK" }, { title: "Restart", postbackText: "restart" }],
                    "Tap *OK* to calculate rates."
                );
            }

            // Validate again before hitting API
            const missing = nextMissing(d);
            if (missing) {
                session.rateStatus = missing.s;
                await saveDraft(session, d);
                return sendMessage(phone, missing.p);
            }

            try {
                const payload = await buildPayload(phone, d);
                session.rateStatus = "fetching";
                await session.save();

                await sendMessage(phone, "Calculating best rates…");
                const data = await getRatesAPI(phone, payload);

                const rows = Object.entries(data || {}).map(([key, val]) => {
                    const item = val || {};
                    const gt = item?.logistos_working?.grand_total ?? item?.rates;
                    const num = typeof gt === "number" ? gt : Number.isFinite(+gt) ? +gt : null;
                    return {
                        partner: item.delivery_partner || key.split("-")[0],
                        mode: item.mode_name || payload.mode_name,
                        grand_total: num,
                        tat: item.tat || item.avg_delivery_days || "",
                        w: item.logistos_working || {},
                    };
                }).filter(r => Number.isFinite(r.grand_total));

                if (!rows.length) {
                    session.rateStatus = "done";
                    session.operation = null;
                    session.rateDraft = {};
                    await session.save();
                    await sendMessage(phone, "No payable options returned for this route/inputs.");
                    return sendQuickReplies(
                        phone,
                        [{ title: "Recalculate", postbackText: "rate" }, { title: "Track Order", postbackText: "track" }],
                        "What next?"
                    );
                }

                rows.sort((a, b) => a.grand_total - b.grand_total);
                const top = rows.slice(0, 5);
                const lines = top.map((r, i) =>
                    `${i === 0 ? "🏆" : "•"} ${r.partner} (${r.mode}) — ₹${r.grand_total.toFixed(0)}${r.tat ? ` — TAT: ${r.tat}d` : ""}`
                ).join("\n");

                const best = top[0];
                const w = best.w || {};
                const breakdown = [
                    w.freight && `Freight: ₹${w.freight}`,
                    w.fsc && `FSC: ₹${w.fsc}`,
                    w.oda && `ODA: ₹${w.oda}`,
                    w.fm_charges && `FM: ₹${w.fm_charges}`,
                    w.handling_charges && `Handling: ₹${w.handling_charges}`,
                    w.gst && `GST: ₹${typeof w.gst === "number" ? w.gst.toFixed(2) : w.gst}`,
                ].filter(Boolean).join(" | ");

                await sendMessage(
                    phone,
                    `📦 *Rate Comparison*\nFrom ${d.pickup_pin} ➝ ${d.drop_pin}\nType: *${d.courier_type}*, Mode: *${best.mode}*\nQty: *${d.units || 1}*, Wt/box: *${d.weight} KG*\nDims: *${d.length}×${d.width}×${d.height} ${d.unit}*\nInvoice: *₹${d.invoice_value}*, Pay: *${d.shipment_payment_type === "0" ? "Prepaid" : d.shipment_payment_type === "1" ? "COD" : "TO-PAY"}*\n\n${lines}\n\n*Best Option:* ${best.partner} — *₹${best.grand_total.toFixed(0)}*\n${breakdown ? `_${breakdown}_` : ""}`
                );

                session.rateStatus = "done";
                session.operation = null;
                session.rateDraft = {};
                await session.save();

                return sendQuickReplies(
                    phone,
                    [
                        { title: "Recalculate", postbackText: "rate" },
                        { title: "Track an Order", postbackText: "track" },
                        { title: "Create Ticket", postbackText: "ticket" },
                        { title: "Logout", postbackText: "logout" }
                    ],
                    "What next?"
                );
            } catch (e) {
                console.error("❌ Rate calc error:", e?.response?.data || e.message);
                session.rateStatus = "confirm";
                await session.save();
                return sendMessage(phone, "Couldn't fetch rates. Check inputs or type *restart*.");
            }
        }

        case "fetching":
            return sendMessage(phone, "Still working… type *restart* to start over.");

        case "done":
            return sendQuickReplies(
                phone,
                [
                    { title: "Recalculate", postbackText: "rate" },
                    { title: "Track an Order", postbackText: "track" },
                    { title: "Create Ticket", postbackText: "ticket" },
                    { title: "Logout", postbackText: "logout" }
                ],
                "All set. What next?"
            );

        default:
            // Safety: jump to first missing field
            const miss = nextMissing(d);
            if (miss) {
                session.rateStatus = miss.s;
                await saveDraft(session, d);
                return sendMessage(phone, miss.p);
            }
            session.rateStatus = "pickup_pin";
            await session.save();
            return sendMessage(phone, "Enter *Origin Pincode*:");
    }
}