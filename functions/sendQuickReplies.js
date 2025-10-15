// sendQuickReplies.js
import axios from "axios";

async function sendQuickReplies(
  phone,
  options,
  text,
  header = "",
  footer = ""
) {
  try {
   

    await axios.post(
      "https://api.gupshup.io/wa/api/v1/msg",
      new URLSearchParams({
        channel: "whatsapp",
        source: process.env.GUPSHUP_SOURCE_NUMBER,
        destination: phone,
        message: JSON.stringify({
          type: "quick_reply",
          content: {
            type: "text",
            text: text,
            caption: footer,
            header: header,
          },
          options: options,
        }),
        "src.name": process.env.GUPSHUP_BOT_NAME,
      }),
      {
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": "application/x-www-form-urlencoded",
          apikey: process.env.GUPSHUP_API_KEY,
        },
      }
    );

    console.log(`📤 Sent quick replies to ${phone}: ${options.join(", ")}`);
  } catch (err) {
    console.error(
      "❌ sendQuickReplies error:",
      err.response?.data || err.message
    );
  }
}

export default sendQuickReplies;
