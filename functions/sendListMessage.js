// functions/sendListMessage.js
import axios from "axios";

/**
 * Accepts BOTH of these signatures:
 *  A) sendListMessage(to, header, body, options[, footer, buttonText])
 *  B) sendListMessage(to, options, body?, footer?, buttonText?)
 *     (used when you passed the options as the 2nd arg)
 */
export default async function sendListMessage(
  to,
  headerOrOptions,
  bodyOrHeader,
  optionsMaybe,
  footerMaybe,
  buttonMaybe
) {
  const apikey = process.env.GUPSHUP_API_KEY;
  const source = process.env.GUPSHUP_SOURCE_NUMBER;
  const appName = process.env.GUPSHUP_BOT_NAME || "Logistos Bot";

  if (!apikey || !source) {
    console.error("❌ Gupshup creds missing: GUPSHUP_API_KEY/GUPSHUP_SOURCE_NUMBER");
    return;
  }

  // ---- Parameter normalization (supports both signatures) ----
  let headerText = "";
  let bodyText = "Choose one:";
  let options = [];
  let footerText = "";
  let buttonText = "Open menu";

  if (Array.isArray(headerOrOptions)) {
    // Signature B
    options = headerOrOptions;
    bodyText = typeof bodyOrHeader === "string" ? bodyOrHeader : "Choose one:";
    footerText = typeof optionsMaybe === "string" ? optionsMaybe : "";
    buttonText = typeof footerMaybe === "string" ? footerMaybe : "Open menu";
  } else {
    // Signature A
    headerText = typeof headerOrOptions === "string" ? headerOrOptions : "";
    bodyText = typeof bodyOrHeader === "string" ? bodyOrHeader : "Choose one:";
    options = Array.isArray(optionsMaybe) ? optionsMaybe : [];
    footerText = typeof footerMaybe === "string" ? footerMaybe : "";
    buttonText = typeof buttonMaybe === "string" ? buttonMaybe : "Open menu";
  }

  // ---- Normalize rows (strings OR {title, postbackText, description}) ----
  const rows = (options || []).slice(0, 10).map((row, i) => {
    if (typeof row === "string") {
      return { id: row, title: row };
    }
    return {
      id: String(row.postbackText ?? row.title ?? `row_${i + 1}`),
      title: String(row.title ?? `Row ${i + 1}`),
      ...(row.description ? { description: String(row.description) } : {}),
    };
  });

  const payload = new URLSearchParams({
    source,
    destination: to,
    "src.name": appName,
    message: JSON.stringify({
      type: "list",
      title: headerText,                 // list header (top bold line)
      body: bodyText,                    // list body
      msgid: `list_${Date.now()}`,
      globalButtons: [{ type: "text", title: buttonText }],
      items: [
        {
          title: "Options",
          options: rows.map((r) => ({
            type: "text",
            title: r.title,
            ...(r.description ? { description: r.description } : {}),
            postbackText: r.id,          // this is what you’ll receive back
          })),
        },
      ],
    }),
  });

  try {
    console.log(`📤 Sending list to ${to}: ${JSON.stringify(rows.map(r => r.title))}`);
    const res = await axios.post("https://api.gupshup.io/wa/api/v1/msg", payload, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        apikey,
      },
      timeout: 15000,
    });
    console.log("✅ List response:", JSON.stringify(res.data));
    return res.data;
  } catch (err) {
    console.error("❌ Send list error:", err.response?.data || err.message);
  }
}
