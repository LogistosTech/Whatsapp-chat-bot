// functions/sendQuickReplies.js
import axios from "axios";

function normalizeOptions(options = []) {
  // Accept: "track" OR { title, postbackText }
  return options.map((opt, i) => {
    if (typeof opt === "string") {
      return { type: "text", title: opt, postbackText: opt };
    }
    // ensure shape + defaults
    return {
      type: "text",
      title: String(opt.title ?? `Option ${i + 1}`),
      postbackText: String(opt.postbackText ?? opt.title ?? `opt_${i + 1}`)
    };
  });
}

export default async function sendQuickReplies(
  phone,
  options,
  text,
  header = "",
  footer = ""
) {
  const apikey = process.env.GUPSHUP_API_KEY;
  const source = process.env.GUPSHUP_SOURCE_NUMBER;
  const appName = process.env.GUPSHUP_BOT_NAME;

  if (!apikey || !source) {
    console.error("❌ Gupshup creds missing: GUPSHUP_API_KEY/GUPSHUP_SOURCE_NUMBER");
    return;
  }

  // Gupshup/WA allows max 3 buttons
  const normalized = normalizeOptions(options).slice(0, 3);

  const payload = new URLSearchParams({
    channel: "whatsapp",
    source,
    destination: phone,
    "src.name": appName || "Logistos Bot",
    message: JSON.stringify({
      type: "quick_reply",
      content: {
        type: "text",
        text,
        ...(header ? { header } : {}),
        ...(footer ? { caption: footer } : {}),
      },
      options: normalized
    }),
  });

  try {
    console.log(`📤 Sending quick replies to ${phone}: ${JSON.stringify(normalized.map(o => o.title))}`);
    const resp = await axios.post(
      "https://api.gupshup.io/wa/api/v1/msg",
      payload,
      {
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": "application/x-www-form-urlencoded",
          apikey,
        },
        timeout: 15000,
      }
    );
    console.log("✅ Quick replies response:", JSON.stringify(resp.data));
    return resp.data;
  } catch (err) {
    console.error("❌ sendQuickReplies error:", err.response?.data || err.message);
  }
}
