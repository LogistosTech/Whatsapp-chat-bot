// helpers/rateCalcHelper.js
import sendMessage from "../functions/sendMessage.js";
import sendQuickReplies from "../functions/sendQuickReplies.js";
import sendListMessage from "../functions/sendListMessage.js";
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
    // accepts "30x20x15", "30*20*15", "30,20,15", "30 20 15"
    const nums = String(input).replace(/[^\d.\s, x*]/gi, "")
        .replace(/[x*]/gi, " ")
        .split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.length < 3 || nums.some(isNaN)) return null;
    const [length, width, height] = nums;
    return { length, width, height };
}

export async function startRateFlow(phone, session) {
    session.operation = "ratecalc";
    session.rateStatus = "pickup_pin";
    session.rateDraft = {};
    await session.save();

    await sendMessage(phone, "Enter *Origin Pincode*:");
}

function buildRatePayload(d) {
    // coerce numbers safely
    const units = Number.isFinite(+d.units) && +d.units > 0 ? (+d.units | 0) : 1;
    const perBoxW = Number.isFinite(+d.weight) && +d.weight > 0 ? +d.weight : 0;
    const length = Number.isFinite(+d.length) ? +d.length : 0;
    const width = Number.isFinite(+d.width) ? +d.width : 0;
    const height = Number.isFinite(+d.height) ? +d.height : 0;
    const unit = (d.unit === "IN" || d.unit === "CM") ? d.unit : "CM";

    // convert IN → CM for API
    const toCM = unit === "IN"
        ? (n) => +(n * 2.54).toFixed(2)
        : (n) => +n;

    const qty = Math.max(1, units);
    const totalWeight = +(qty * perBoxW).toFixed(2);

    const spt = ["0", "1", "2"].includes(String(d.shipment_payment_type)) ? String(d.shipment_payment_type) : "0";
    const payAmt = Number.isFinite(+d.shipment_payment_amount) ? +d.shipment_payment_amount : undefined;

    const payload = {
        pickup_pin: String(d.pickup_pin || "").trim(),
        mode_name: d.mode_name || "surface",
        from_city: "", from_state: "",
        drop_pin: String(d.drop_pin || "").trim(),
        to_city: "", to_state: "",
        quantity: qty,
        weight: totalWeight,
        invoice_value: Number.isFinite(+d.invoice_value) ? +d.invoice_value : 0,
        mps_details: [{
            units: qty,               // ✅ never null
            weight: perBoxW,          // per-box
            length: toCM(length),
            width: toCM(width),
            height: toCM(height),
            unit: "CM",
        }],
        shipment_payment_type: spt,
        is_to_pay: spt === "2",
        is_cod: spt === "1",
        ...(spt === "1" && payAmt != null ? { cod_amount: payAmt } : {}),
        ...(spt !== "0" && payAmt != null ? { shipment_payment_amount: payAmt } : {}),
        rov_mode: "rov_owner",
        special_delivery_type: "",
        courier_type: (d.courier_type === "B2B" || d.courier_type === "B2C") ? d.courier_type : "B2C",
        self_drop: false,
        is_abd_scheduled: false,
    };

    // minimal guards
    if (!/^\d{6}$/.test(payload.pickup_pin) || !/^\d{6}$/.test(payload.drop_pin)) {
        throw new Error("Invalid pincode(s).");
    }
    if (payload.weight <= 0 || payload.quantity <= 0 || payload.mps_details[0].units <= 0) {
        throw new Error("Invalid weight/quantity.");
    }
    return JSON.parse(JSON.stringify(payload)); // strip undefined
}

export default async function rateCalcHelper(phone, msg = "") {
    const Session = (await import("../models/sessionModel.js")).default;
    let session = await Session.findOne({ phone });
    if (!session) return;

    // allow reset/logout shortcuts
    const lower = (msg || "").toLowerCase();
    if (lower === "restart") {
        session.operation = null;
        session.rateStatus = "init";
        session.rateDraft = {};
        await session.save();
        return sendQuickReplies(
            phone,
            [
                { title: "Rate Calculator", postbackText: "rate" },
                { title: "Book a Shipment", postbackText: "book" },
                { title: "Track an Order", postbackText: "track" },
                { title: "Logout", postbackText: "logout" },
            ],
            "Restarted. What do you want to do?",
            "Logistos Bot",
            "Menu"
        );
    }
    if (lower === "logout") {
        await sendMessage(phone, "You have been logged out. Type *hi* to log in again.");
        await Session.deleteOne({ phone });
        return;
    }

    // align op
    if (session.operation === null || session.operation === "booking" || session.operation === "tracking" || session.operation === "ticketing") {
        session.operation = "ratecalc";
        await session.save();
    }

    let st = session.rateStatus || "init";
    switch (st) {
        case "init":
            session.rateStatus = "pickup_pin";
            await session.save();
            return sendMessage(phone, "Enter *Origin Pincode*:");

        case "pickup_pin": {
            const pin = String(msg).trim();
            if (!/^\d{6}$/.test(pin)) return sendMessage(phone, "Please enter a valid 6-digit *Origin Pincode*:");
            session.rateDraft.pickup_pin = pin;
            session.rateStatus = "drop_pin";
            await session.save();
            return sendMessage(phone, "Enter *Destination Pincode*:");
        }

        case "drop_pin": {
            const pin = String(msg).trim();
            if (!/^\d{6}$/.test(pin)) return sendMessage(phone, "Please enter a valid 6-digit *Destination Pincode*:");
            session.rateDraft.drop_pin = pin;
            session.rateStatus = "courier_type";
            await session.save();
            return sendQuickReplies(phone, COURIER_TYPES, "Select *Courier Type*:", "Logistos Bot", "Choose");
        }

        case "courier_type": {
            const ct = ["B2B", "B2C"].includes(msg) ? msg : null;
            if (!ct) return sendQuickReplies(phone, COURIER_TYPES, "Pick *B2B* or *B2C*:");
            session.rateDraft.courier_type = ct;
            session.rateStatus = "mode";
            await session.save();
            return sendQuickReplies(phone, MODES, "Select *Mode*:", "Logistos Bot", "Choose");
        }

        case "mode": {
            const m = ["surface", "air", "railway"].includes(msg) ? msg : null;
            if (!m) return sendQuickReplies(phone, MODES, "Select *Mode*:");
            session.rateDraft.mode_name = m;
            session.rateStatus = "units";
            await session.save();
            return sendMessage(phone, session.rateDraft.courier_type === "B2C"
                ? "Enter *Box Count* (B2C allows only 1):"
                : "Enter *Box Count* (e.g., 1, 2, 3):");
        }

        case "units": {
            let units = Number(String(msg).trim());
            if (!Number.isFinite(units) || units <= 0) return sendMessage(phone, "Enter a valid *Box Count*:");
            if (session.rateDraft.courier_type === "B2C" && units !== 1) {
                units = 1; // enforce
                await sendMessage(phone, "B2C allows only 1 box. Proceeding with *1*.");
            }
            session.rateDraft.units = units;
            session.rateStatus = "weight";
            await session.save();
            return sendMessage(phone, "Enter *Weight per Box in KG* (e.g., 5):");
        }

        case "weight": {
            const w = Number(String(msg).trim());
            if (!Number.isFinite(w) || w <= 0) return sendMessage(phone, "Enter a valid *weight in KG*:");
            if (session.rateDraft.courier_type === "B2C" && w > 30) {
                return sendMessage(phone, "B2C limit is 30 KG per box. Enter ≤ *30* KG, or type *restart* and choose B2B.");
            }
            session.rateDraft.weight = w;
            session.rateStatus = "dimension";
            await session.save();
            return sendQuickReplies(phone,
                [{ title: "CM", postbackText: "CM" }, { title: "IN", postbackText: "IN" }],
                "Select *Dimension Unit* for L×W×H:",
                "Logistos Bot",
                "Units"
            );
        }

        case "dimension": {
            const unit = ["CM", "IN"].includes(msg) ? msg : null;
            if (!unit) return sendQuickReplies(phone,
                [{ title: "CM", postbackText: "CM" }, { title: "IN", postbackText: "IN" }],
                "Pick *CM* or *IN*:"
            );
            session.rateDraft.unit = unit;
            session.rateStatus = "dims";
            await session.save();
            return sendMessage(phone, "Send *Length x Width x Height* (e.g., `30x20x15`):");
        }

        case "dims": {
            const dims = parseDims(msg);
            if (!dims) return sendMessage(phone, "Couldn’t read that. Send like *30x20x15* (or 30,20,15)");
            session.rateDraft.length = dims.length;
            session.rateDraft.width = dims.width;
            session.rateDraft.height = dims.height;
            session.rateStatus = "invoice";
            await session.save();
            return sendMessage(phone, "Enter *Declared Value (₹)*:");
        }

        case "invoice": {
            const inv = Number(String(msg).trim());
            if (!Number.isFinite(inv) || inv < 0) return sendMessage(phone, "Enter a valid *amount* (₹):");
            session.rateDraft.invoice_value = inv;
            session.rateStatus = "paytype";
            await session.save();
            return sendQuickReplies(phone, PAY_TYPES, "Select *Payment Type*:", "Logistos Bot", "Choose");
        }

        case "paytype": {
            const pt = ["0", "1", "2"].includes(msg) ? msg : null;
            if (!pt) return sendQuickReplies(phone, PAY_TYPES, "Pick *Prepaid*, *COD*, or *TO-PAY*:");
            session.rateDraft.shipment_payment_type = pt;
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
            const amt = Number(String(msg).trim());
            if (!Number.isFinite(amt) || amt < 0) return sendMessage(phone, "Enter a valid amount (₹):");
            session.rateDraft.shipment_payment_amount = amt;
            session.rateStatus = "confirm";
            await session.save();
            return sendMessage(phone, "Type *OK* to calculate rates or *restart* to start over.");
        }

        case "confirm": {
            if (lower !== "ok") return sendMessage(phone, 'Please type *OK* to proceed (or *restart*).');

            const d = session.rateDraft || {};
            const missing = [];
            if (!/^\d{6}$/.test(String(d.pickup_pin || ""))) missing.push("Origin Pincode");
            if (!/^\d{6}$/.test(String(d.drop_pin || ""))) missing.push("Destination Pincode");
            if (!d.courier_type) missing.push("Courier Type");
            if (!d.mode_name) missing.push("Mode");
            if (!d.units) missing.push("Box Count");
            if (!d.weight) missing.push("Weight per Box");
            if (!d.length || !d.width || !d.height || !d.unit) missing.push("Dimensions");
            if (typeof d.invoice_value !== "number") missing.push("Declared Value");

            if (missing.length) {
                // bounce back to first missing step instead of throwing
                session.rateStatus = "pickup_pin";
                session.rateDraft = {}; // clear stale data to avoid weird loops
                await session.save();
                return sendMessage(phone,
                    `We need a few details first: *${missing.join(", ")}*.\n\nEnter *Origin Pincode* to start:`);
            }

            try {
                const payload = buildRatePayload(d); // ✅ sanitized
                session.rateStatus = "fetching";
                await session.save();
                await sendMessage(phone, "Calculating best rates…");

                const data = await getRatesAPI(phone, payload);

                try {
                    const data = await getRatesAPI(phone, payload);
                    const rows = Object.entries(data).map(([key, val]) => {
                        const item = val || {};
                        const price = item?.rates;
                        const gt = item?.logistos_working?.grand_total ?? price;
                        const numeric = typeof gt === "number" ? gt : Number.isFinite(+gt) ? +gt : null;
                        return {
                            key,
                            partner: item.delivery_partner || key.split("-")[0],
                            mode: item.mode_name || payload.mode_name,
                            grand_total: numeric,
                            tat: item.tat || item.avg_delivery_days || "",
                            w: item?.logistos_working || {},
                            logo: item.logo || null,
                        };
                    });

                    const valid = rows.filter(r => Number.isFinite(r.grand_total));
                    if (!valid.length) {
                        session.rateStatus = "done";
                        await session.save();
                        await sendMessage(phone, "No payable options returned for this route/inputs.");
                        return sendQuickReplies(
                            phone,
                            [
                                { title: "Try Different Inputs", postbackText: "rate" },
                                { title: "Book a Shipment", postbackText: "book" },
                                { title: "Logout", postbackText: "logout" },
                            ],
                            "What next?",
                            "Logistos Bot",
                            "Choose"
                        );
                    }

                    valid.sort((a, b) => a.grand_total - b.grand_total);
                    const top = valid.slice(0, 5);

                    const lines = top.map((r, i) =>
                        `${i === 0 ? "🏆" : "•"} ${r.partner} (${r.mode}) — ₹${r.grand_total.toFixed(0)}${r.tat ? ` — TAT: ${r.tat}d` : ""}`
                    ).join("\n");

                    const best = top[0];
                    const w = best.w || {};
                    const breakdown = [
                        w.freight ? `Freight: ₹${w.freight}` : null,
                        w.fsc ? `FSC: ₹${w.fsc}` : null,
                        w.oda ? `ODA: ₹${w.oda}` : null,
                        w.fm_charges ? `FM: ₹${w.fm_charges}` : null,
                        w.lm_charges ? `LM: ₹${w.lm_charges}` : null,
                        w.handling_charges ? `Handling: ₹${w.handling_charges}` : null,
                        w.gst ? `GST: ₹${typeof w.gst === 'number' ? w.gst.toFixed(2) : w.gst}` : null,
                    ].filter(Boolean).join(" | ");

                    const msgText =
                        `📦 *Rate Comparison*
From ${d.pickup_pin} ➝ ${d.drop_pin}
Type: *${d.courier_type}*, Mode: *${best.mode}*
Qty: *${d.units}*, Wt/box: *${d.weight} KG*
Dims: *${d.length}×${d.width}×${d.height} ${d.unit}*
Invoice: *₹${d.invoice_value}*, Pay: *${d.shipment_payment_type === "0" ? "Prepaid" : d.shipment_payment_type === "1" ? "COD" : "TO-PAY"}*

${lines}

*Best Option:* ${best.partner} — *₹${best.grand_total.toFixed(0)}*
${breakdown ? `_${breakdown}_` : ""}`;

                    await sendMessage(phone, msgText);

                    await sendQuickReplies(
                        phone,
                        [
                            { title: "Recalculate", postbackText: "rate" },
                            { title: "Book a Shipment", postbackText: "book" },
                            { title: "Track an Order", postbackText: "track" },
                            { title: "Logout", postbackText: "logout" },
                        ],
                        "What next?",
                        "Logistos Bot",
                        "Choose"
                    );

                    session.rateStatus = "done";
                    session.operation = null;
                    session.rateDraft = {};
                    await session.save();
                } catch (err) {
                    console.error("❌ Rate calc error:", err?.response?.data || err.message);
                    session.rateStatus = "confirm";
                    await session.save();
                    await sendMessage(phone, "Couldn’t fetch rates. Check inputs or type *restart*.");
                }
                return; // ✅ close inner try-catch properly
            } catch (err) {  // ✅ outer catch added
                console.error("❌ Payload/build error:", err.message);
                await sendMessage(phone, "Something went wrong while preparing your rate request. Type *restart* to try again.");
            }
            break;
        }

        case "fetching":
            return sendMessage(phone, "Still working… type *restart* to start over.");

        case "done":
            return sendQuickReplies(
                phone,
                [
                    { title: "Recalculate", postbackText: "rate" },
                    { title: "Book a Shipment", postbackText: "book" },
                    { title: "Track an Order", postbackText: "track" },
                    { title: "Logout", postbackText: "logout" },
                ],
                "All set. What next?",
                "Logistos Bot",
                "Menu"
            );

        default:
            return; // don't silently reset to pickup_pin

        // default:
        //     // restart lightweight
        //     session.rateStatus = "pickup_pin";
        //     session.operation = "ratecalc";
        //     session.rateDraft = {};
        //     await session.save();
        //     return sendMessage(phone, "Enter *Origin Pincode*:");
    }
}
