import { WebSocket } from "ws";
const ws = new WebSocket("ws://127.0.0.1:8080");
ws.on("open", () => ws.send(JSON.stringify({ t: "join", name: "peek" })));
let n = 0;
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t !== "snapshot") return;
  if (++n < 4) return;
  for (const p of m.players) {
    console.log(`${p.name.padEnd(12)} x=${p.x.toFixed(2).padStart(7)}  z=${p.z.toFixed(2).padStart(7)}  ack=${p.ack}`);
  }
  ws.close();
  process.exit(0);
});
