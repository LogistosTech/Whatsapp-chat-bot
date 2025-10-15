import axios from "axios";

async function sendListMessage(to, header, body, textArray) {
  try {
    
    const res = await axios.post(
      "https://api.gupshup.io/wa/api/v1/msg",
      new URLSearchParams({
        source: process.env.GUPSHUP_SOURCE_NUMBER,
        destination: to,
        "src.name": process.env.GUPSHUP_BOT_NAME,
        message: JSON.stringify({
          type: "list",
          title: header,
          body: body,
          msgid: "list_001",
          globalButtons: [
            {
              type: "text",
              title: "Choose an option",
            }
          ],
          items: [
            {
              options: textArray
            }
          ]
        })
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          apikey: process.env.GUPSHUP_API_KEY
        }
      }
    );

    

    console.log(' Selection Response:', res);
    

    console.log(`📤 Sent list message to ${to} with ${textArray.length} items`);
  } catch (err) {
    console.error("❌ Send list error:", err.response?.data || err.message);
  }
}

export default sendListMessage;