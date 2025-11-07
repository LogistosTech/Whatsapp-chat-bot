// functions/sendListMessage.js
import axios from "axios";

function normalizeRows(textArray = []) {
  // Accept: "Track an Order" OR { title, postbackText, description }
  return textArray.slice(0, 10).map((row, i) => {
    if (typeof row === "string") {
      return { id: row, title: row };
    }
    return {
      id: String(row.postbackText ?? row.title ?? `row_${i + 1}`),
      title: String(row.title ?? `Row ${i + 1}`),
      ...(row.description ? { description: String(row.description) } : {}),
    };
  });
}

/**
 * Keep your existing signature: (to, header, body, textArray)
 * - Use when you have 4–10 options.
 */
export default async function sendListMessage(to, header, body, textArray) {
  const apikey = process.env.GUPSHUP_API_KEY;
  const source = process.env.GUPSHUP_SOURCE_NUMBER;
  const appName = process.env.GUPSHUP_BOT_NAME;

  if (!apikey || !source) {
    console.error("❌ Gupshup creds missing: GUPSHUP_API_KEY/GUPSHUP_SOURCE_NUMBER");
    return;
  }

  const rows = normalizeRows(textArray);

  const payload = new URLSearchParams({
    source,
    destination: to,
    "src.name": appName || "Logistos Bot",
    message: JSON.stringify({
      type: "list",
      title: header,         // header text
      body,                  // body text
      msgid: `list_${Date.now()}`, // uniqueish id
      globalButtons: [{ type: "text", title: "Choose an option" }],
      items: [
        {
          title: "Options",
          options: rows.map(r => ({
            type: "text",
            title: r.title,
            ...(r.description ? { description: r.description } : {}),
            postbackText: r.id
          }))
        }
      ]
    })
  });

  try {
    console.log(`📤 Sending list to ${to}: ${JSON.stringify(rows.map(r => r.title))}`);
    const res = await axios.post(
      "https://api.gupshup.io/wa/api/v1/msg",
      payload,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          apikey,
        },
        timeout: 15000,
      }
    );
    console.log("✅ List response:", JSON.stringify(res.data));
    console.log(`📤 Sent list message to ${to} with ${rows.length} items`);
    return res.data;
  } catch (err) {
    console.error("❌ Send list error:", err.response?.data || err.message);
  }
}
