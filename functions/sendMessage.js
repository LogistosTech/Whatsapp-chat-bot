import axios from 'axios';

async function sendMessage(to, text) {
  try {
    await axios.post('https://api.gupshup.io/sm/api/v1/msg', null, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'apikey': process.env.GUPSHUP_API_KEY
      },
      params: {
        channel: 'whatsapp',
        source: process.env.GUPSHUP_SOURCE_NUMBER,
        destination: to,
        message: text,
        'src.name': process.env.GUPSHUP_BOT_NAME
      }
    });
    console.log(`📤 Sent to ${to}: ${text}`);
  } catch (err) {
    console.error('❌ Send error:', err.response?.data || err.message);
  }

}

export default sendMessage;