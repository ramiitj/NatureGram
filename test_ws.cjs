const WebSocket = require('ws');
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

const ws = new WebSocket(url);
ws.on('open', () => {
    console.log('Connected');
    ws.send(JSON.stringify({
        setup: { model: "models/gemini-2.0-flash" }
    }));
});
ws.on('message', (msg) => {
    console.log('Message:', msg.toString());
    ws.close();
});
ws.on('error', (err) => {
    console.error('Error:', err.message);
});
