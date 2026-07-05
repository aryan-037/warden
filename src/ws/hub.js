const { WebSocketServer } = require("ws");

let wss = null;

function init(server) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "connected", message: "Warden live feed connected." }));
  });
  console.log("WebSocket hub attached at /ws");
}

function broadcast(type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

module.exports = { init, broadcast };
