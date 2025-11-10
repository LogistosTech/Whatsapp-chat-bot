// helpers/rateCalcHelper.js — intent sniffer + strict B2C, confirm resume (drop-in)
import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import getRatesAPI from "../APIS/getRatesAPI.js";

const COURIER_TYPES = [
    { title: "B2C", postbackText: "B2C" },
    { title: "B2B", postbackText: "B2B" },
];
const MODES = [
    { title: "Surface", postbackText: "surface" },
    { title: "Air", postbackText: "air" },
    { title: "Railway", postbackText: "railway" },
];
const PAY_TYPES = [
    { title: "Prepaid", postbackText: "0" },
    { title: "COD", postbackText: "1" },
    { title: "TO-PAY", postbackText: "2" },
];

function parseDims(input) {
    const nums = String(input)
        .replace(/[^\d.\s, x*]/gi, "")
        .replace(/[x*]/gi, " ")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
    if (nums.length < 3 || nums.some(isNaN)) return null;
    const [length, width, height] = nums;
    return { length, width, height };
}

function buildPayload(d) {
    const units = Math.max(1, d.units | 0);
    const perBoxW = +d.weight;
    const toCM = d.unit === "IN" ? (n) => +(n * 2.54).toFixed(2) : (n) => +n;
    const payload = {
        pickup_pin: String(d.pickup_pin || "").trim(),
        mode_name: d.mode_name || "surface",
        from_city: "",
        from_state: "",
        drop_pin: String(d.drop_pin || "").trim(),
        to_city: "",
        to_state: "",
        quantity: units,
        weight: +(units * perBoxW).toFixed(2),
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
    if (!/^\d{6}$/.test(payload.pickup_pin) || !/^\d{6}$/.test(payload.drop_pin)) {
        throw new Error("Invalid pincode(s)");
    }
    if (!(payload.weight > 0)) throw new Error("Invalid weight");
    return JSON.parse(JSON.stringify(payload));
}

function nextMissing(d) {
    if (!/^\d{6}$/.test(String(d.pickup_pin || ""))) return { s: "pickup_pin", p: "Enter *Origin Pincode*:" };
    if (!/^\d{6}$/.test(String(d.drop_pin || ""))) return { s: "drop_pin", p: "Enter *Destination Pincode*:" };
    if (!d.courier_type) return { s: "courier_type", p: "Select *Courier Type*:" };
    if (!d.mode_name) return { s: "mode", p: "Select *Mode*:" };
    if (!d.units) return { s: "units", p: "Enter *Box Count*:" };
    if (!d.weight) return { s: "weight", p: "Enter *Weight per Box in KG* (e.g., 5):" };
    if (!d.unit) return { s: "dimension", p: "Select *Dimension Unit* for L×W×H:" };
    if (!d.length || !d.width || !d.height) return { s: "dims", p: "Send *Length x Width x Height* (e.g., 30x20x15):" };
    if (typeof d.invoice_value !== "number") return { s: "invoice", p: "Enter *Declared Value (₹)*:" };
    if (d.shipment_payment_type == null) return { s: "paytype", p: "Select *Payment Type*:" };
    return null;
}

export async function startRateFlow(phone, session) {
    session.operation = "ratecalc";
    session.rateStatus = "pickup_pin";
    session.rateDraft = {};
    await session.save();
    await sendMessage(phone, "Enter *Origin Pincode*:");
}

const saveDraft = async (session, d) => {
    session.rateDraft = d;
    session.markModified("rateDraft");
    await session.save();
};


export default async function rateCalcHelper(phone, msg = "") {
    const Session = (await import("../models/sessionModel.js")).default;
    let session = await Session.findOne({ phone });
    if (!session) return;

    const raw = String(msg || "").trim();
    const lower = raw.toLowerCase();

    // Initialize session if needed
    session.operation ||= "ratecalc";
    session.rateDraft ||= {};
    session.rateStatus ||= "init";

    const d = session.rateDraft;
    const currentState = session.rateStatus;

    // 🔧 FIX: Handle restart first
    if (lower === "restart" || lower === "rate") {
        session.operation = null;
        session.rateStatus = "init";
        session.rateDraft = {};
        await session.save();
        // return sendMessage(phone, "Let’s calculate rates. Enter *Origin Pincode*:");
    }

    // 🔧 FIX: Handle OK command - only process in confirm state or when all data is complete
    if (lower === "ok") {
        const missing = nextMissing(d);
        if (!missing) {
            session.rateStatus = "confirm";
            await session.save();
            // Continue to confirmation processing
        } else {
            // If missing fields, jump to the first missing field
            session.rateStatus = missing.s;
            await session.save();
            return sendMessage(phone, missing.p);
        }
    }

    // 🔧 FIX: Simplified intent sniffer - only capture specific values in appropriate states
    if (/^\d{6}$/.test(raw)) {
        if (currentState === "pickup_pin" && !d.pickup_pin) d.pickup_pin = raw;
        else if (currentState === "drop_pin" && !d.drop_pin) d.drop_pin = raw;
    }

    // Only capture these values when not in specific input states
    if (!["pickup_pin", "drop_pin", "units", "weight", "dims", "invoice", "payamount"].includes(currentState)) {
        if (["b2b", "b2c"].includes(lower)) {
            d.courier_type = lower === "b2b" ? "B2B" : "B2C";
        }
        if (["surface", "air", "railway"].includes(lower)) {
            d.mode_name = lower;
        }
        if (["cm", "in"].includes(lower)) {
            d.unit = lower.toUpperCase();
        }
        if (["0", "1", "2", "prepaid", "cod", "to-pay", "to pay"].includes(lower)) {
            d.shipment_payment_type = ["prepaid", "cod", "to-pay", "to pay"].includes(lower)
                ? ({ prepaid: "0", cod: "1", "to-pay": "2", "to pay": "2" }[lower])
                : raw;
        }
    }

    // Capture numeric values for units only when appropriate
    if (/^\d+$/.test(raw) && !d.units && Number(raw) > 0 && Number(raw) < 10000) {
        d.units = Number(raw);
    }

    await saveDraft(session, d);

    // 🔧 FIX: Check for missing fields and jump to them if needed
    const missingNow = nextMissing(d);
    if (
        missingNow &&
        missingNow.s !== currentState &&          // <-- only re-prompt if it’s a different step
        !["confirm", "fetching", "done"].includes(currentState)
    ) {
        session.rateStatus = missingNow.s;
        await session.save();
        return sendMessage(phone, missingNow.p);
    }

    let st = session.rateStatus;

    switch (st) {
        case "init":
            session.rateStatus = "pickup_pin";
            await session.save();
            return sendMessage(phone, "Enter *Origin Pincode*:");

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
            const ct = lower === "b2b" ? "B2B" : lower === "b2c" ? "B2C" : null;
            if (!ct) return sendQuickReplies(phone, COURIER_TYPES, "Pick *B2B* or *B2C*:");
            d.courier_type = ct;
            session.rateStatus = "mode";
            await saveDraft(session, d);
            return sendQuickReplies(phone, MODES, "Select *Mode*:");
        }

        case "mode": {
            const m = ["surface", "air", "railway"].includes(lower) ? lower : null;
            if (!m) return sendQuickReplies(phone, MODES, "Select *Mode*:");
            d.mode_name = m;
            session.rateStatus = "units";
            await session.save();
            return sendMessage(
                phone,
                d.courier_type === "B2C" ? "Enter *Box Count* (B2C allows only 1):" : "Enter *Box Count* (e.g., 1, 2, 3):"
            );
        }

        case "units": {
            let units = Number(raw);
            if (!Number.isFinite(units) || units <= 0) return sendMessage(phone, "Enter a valid *Box Count*:");
            if (d.courier_type === "B2C" && units !== 1) {
                units = 1;
                await sendMessage(phone, "B2C allows only 1 box. Proceeding with *1*.");
            }
            d.units = units;
            session.rateStatus = "weight";
            await session.save();
            return sendMessage(phone, "Enter *Weight per Box in KG* (e.g., 5):");
        }

        case "weight": {
            const w = Number(raw);
            if (!Number.isFinite(w) || w <= 0) return sendMessage(phone, "Enter a valid *weight in KG*:");
            if (d.courier_type === "B2C" && w > 30) {
                return sendMessage(phone, "B2C limit is 30 KG per box. Enter ≤ *30* KG, or type *restart* and choose B2B.");
            }
            d.weight = w;
            session.rateStatus = "dimension";
            await session.save();
            return sendQuickReplies(phone,
                [{ title: "CM", postbackText: "CM" }, { title: "IN", postbackText: "IN" }],
                "Select *Dimension Unit* for L×W×H:"
            );
        }

        case "dimension": {
            const unit = ["cm", "in"].includes(lower) ? lower.toUpperCase() : null;
            if (!unit) return sendQuickReplies(phone,
                [{ title: "CM", postbackText: "CM" }, { title: "IN", postbackText: "IN" }],
                "Pick *CM* or *IN*:"
            );
            d.unit = unit;
            session.rateStatus = "dims";
            await session.save();
            return sendMessage(phone, "Send *Length x Width x Height* (e.g., 30x20x15):");
        }

        case "dims": {
            const dims = parseDims(raw);
            if (!dims) return sendMessage(phone, "Couldn't read that. Send like *30x20x15* (or 30,20,15)");
            d.length = dims.length;
            d.width = dims.width;
            d.height = dims.height;
            session.rateStatus = "invoice";
            await session.save();
            return sendMessage(phone, "Enter *Declared Value (₹)*:");
        }

        case "invoice": {
            const inv = Number(raw);
            if (!Number.isFinite(inv) || inv < 0) return sendMessage(phone, "Enter a valid *amount* (₹):");
            d.invoice_value = inv;
            session.rateStatus = "paytype";
            await session.save();
            return sendQuickReplies(phone, PAY_TYPES, "Select *Payment Type*:");
        }

        case "paytype": {
            const map = { prepaid: "0", cod: "1", "to-pay": "2", "to pay": "2" };
            const pt = ["0", "1", "2"].includes(raw) ? raw : map[lower];
            if (!pt) return sendQuickReplies(phone, PAY_TYPES, "Pick *Prepaid*, *COD*, or *TO-PAY*:");
            d.shipment_payment_type = pt;
            if (pt === "1" || pt === "2") {
                session.rateStatus = "payamount";
                await session.save();
                return sendMessage(phone, `Enter *${pt === "1" ? "COD" : "TO-PAY"} Amount (₹)*:`);
            }
            session.rateStatus = "confirm";
            await session.save();
            return sendMessage(phone, "Type *OK* to calculate rates or *restart* to start over.");
        }

        case "payamount": {
            const amt = Number(raw);
            if (!Number.isFinite(amt) || amt < 0) return sendMessage(phone, "Enter a valid amount (₹):");
            d.shipment_payment_amount = amt;
            session.rateStatus = "confirm";
            await session.save();
            return sendMessage(phone, "Type *OK* to calculate rates or *restart* to start over.");
        }

        case "confirm": {
            // 🔧 FIX: Double-check all required fields are present
            const miss = nextMissing(d);
            if (miss) {
                session.rateStatus = miss.s;
                await session.save();
                return sendMessage(phone, miss.p);
            }

            try {
                const payload = buildPayload(d);
                session.rateStatus = "fetching";
                await session.save();
                await sendMessage(phone, "Calculating best rates…");
                const data = await getRatesAPI(phone, payload);

                const rows = Object.entries(data).map(([key, val]) => {
                    const item = val || {};
                    const gt = item?.logistos_working?.grand_total ?? item?.rates;
                    const num = typeof gt === "number" ? gt : Number.isFinite(+gt) ? +gt : null;
                    return {
                        partner: item.delivery_partner || key.split("-")[0],
                        mode: item.mode_name || payload.mode_name,
                        grand_total: num,
                        tat: item.tat || item.avg_delivery_days || "",
                        w: item.logistos_working || {}
                    };
                }).filter(r => Number.isFinite(r.grand_total));

                if (!rows.length) {
                    session.rateStatus = "done";
                    await session.save();
                    await sendMessage(phone, "No payable options returned for this route/inputs.");
                    return sendQuickReplies(phone,
                        [{ title: "Recalculate", postbackText: "rate" }, { title: "Book a Shipment", postbackText: "book" }],
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
                    w.gst && `GST: ₹${typeof w.gst === "number" ? w.gst.toFixed(2) : w.gst}`
                ].filter(Boolean).join(" | ");

                await sendMessage(phone,
                    `📦 *Rate Comparison*\nFrom ${d.pickup_pin} ➝ ${d.drop_pin}\nType: *${d.courier_type}*, Mode: *${best.mode}*\nQty: *${d.units}*, Wt/box: *${d.weight} KG*\nDims: *${d.length}×${d.width}×${d.height} ${d.unit}*\nInvoice: *₹${d.invoice_value}*, Pay: *${d.shipment_payment_type === "0" ? "Prepaid" : d.shipment_payment_type === "1" ? "COD" : "TO-PAY"}*\n\n${lines}\n\n*Best Option:* ${best.partner} — *₹${best.grand_total.toFixed(0)}*\n${breakdown ? `_${breakdown}_` : ""}`
                );

                await sendQuickReplies(phone,
                    [
                        { title: "Recalculate", postbackText: "rate" },
                        { title: "Book a Shipment", postbackText: "book" },
                        { title: "Track an Order", postbackText: "track" }
                    ],
                    "What next?"
                );

                session.rateStatus = "done";
                session.operation = null;
                session.rateDraft = {};
                await session.save();
                return;
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
            return sendQuickReplies(phone,
                [
                    { title: "Recalculate", postbackText: "rate" },
                    { title: "Book a Shipment", postbackText: "book" },
                    { title: "Track an Order", postbackText: "track" }
                ],
                "All set. What next?"
            );

        default:
            return sendMessage(phone, "Type *restart* to begin a new rate calculation.");
    }
}