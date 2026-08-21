/**
 * Two-client integration smoke test for the authoritative server.
 *
 * Testing multiplayer by opening two tabs and squinting does not scale and
 * does not catch regressions. This connects two real clients, drives one of
 * them, and asserts the four properties that actually have to hold:
 *
 *   1. Both clients join and receive a welcome.
 *   2. A client that sends movement input actually moves.
 *   3. Each client SEES the other in its snapshots -- the whole point.
 *   4. Collision holds: walking into a wall does not leave the room.
 *
 * Usage:  node tools/netsmoke.mjs   (server must already be running)
 */

import { WebSocket } from "ws";

const URL = process.env.ASHFALL_URL ?? "ws://127.0.0.1:8080";
const TICK_MS = 50;

function client(name) {
  const ws = new WebSocket(URL);
  const state = { name, id: null, snapshots: [], seq: 0, ws };

  ws.on("open", () => ws.send(JSON.stringify({ t: "join", name })));
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === "welcome") state.id = msg.id;
    else if (msg.t === "snapshot") state.snapshots.push(msg);
  });
  return state;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function self(c) {
  const last = c.snapshots.at(-1);
  return last?.players.find((p) => p.id === c.id) ?? null;
}

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const a = client("tester-a");
const b = client("tester-b");

await wait(600);

check("both clients joined", !!a.id && !!b.id, `a=${a.id} b=${b.id}`);
check("snapshots arriving", a.snapshots.length > 3, `${a.snapshots.length} in 600ms`);

const start = self(a);

// Drive A east for ~1 second. dt matches the client's frame cadence.
for (let i = 0; i < 20; i++) {
  a.ws.send(
    JSON.stringify({ t: "input", input: { seq: ++a.seq, dx: 1, dz: 0, dt: TICK_MS / 1000 } })
  );
  await wait(TICK_MS);
}
await wait(200);

const moved = self(a);
check(
  "input moves the player",
  moved && Math.abs(moved.x - start.x) > 1.0,
  `x ${start?.x.toFixed(2)} -> ${moved?.x.toFixed(2)}`
);

check(
  "server acknowledges inputs",
  moved && moved.ack > 0,
  `ack=${moved?.ack} of ${a.seq} sent`
);

const bSeesA = b.snapshots.at(-1)?.players.some((p) => p.id === a.id);
const aSeesB = a.snapshots.at(-1)?.players.some((p) => p.id === b.id);
check("clients see each other", !!bSeesA && !!aSeesB);

// Drive A east until it is pressed against the wall.
//
// Cadence matters: the server drains at most MAX_INPUTS_PER_TICK per 50 ms
// tick, so sending faster than the tick rate does NOT move you faster -- it
// just queues. An earlier version of this test fired every 25 ms, got
// throttled, stopped 1.3 m short of the wall, and still "passed" its x < 20
// assertion without ever touching the thing it claimed to test.
for (let i = 0; i < 140; i++) {
  a.ws.send(
    JSON.stringify({ t: "input", input: { seq: ++a.seq, dx: 1, dz: 0, dt: TICK_MS / 1000 } })
  );
  await wait(TICK_MS);
}
await wait(300);

const pinned = self(a);
// Wall centre is x = 20 with half-extent 0.5, player radius 0.4, so the
// resting contact position is 20 - 0.5 - 0.4 = 19.1.
const WALL_CONTACT = 19.1;
check(
  "collision stops the player at the wall",
  pinned && Math.abs(pinned.x - WALL_CONTACT) < 0.15,
  `x=${pinned?.x.toFixed(3)} (expected ~${WALL_CONTACT})`
);

// Speedhack: claim an absurd dt and an unnormalised direction.
const before = self(a);
a.ws.send(
  JSON.stringify({ t: "input", input: { seq: ++a.seq, dx: 999, dz: 999, dt: 60 } })
);
await wait(300);
const after = self(a);
check(
  "server rejects oversized dt and direction",
  after && Math.hypot(after.x - before.x, after.z - before.z) < 1.0,
  `moved ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(3)}m on a 60s claim`
);

// --- SUSTAINED dt inflation ------------------------------------------------
// The single-input check above only proves ONE oversized dt is clamped. It does
// NOT prove the per-tick budget holds, and it did not: applyInput ran BEFORE
// the budget was decremented, so an input claiming dt=0.1 advanced the full
// 0.1 s even when only 0.0625 s of budget remained. Sustained at tick rate that
// is exactly 2x speed - a working speedhack that passed the whole test suite.
//
// Two clients, same duration, same direction. One honest, one inflating dt.
const honest = client("honest");
const cheat = client("cheat");
await wait(700);

const h0 = self(honest), c0 = self(cheat);
const RUN_MS = 1500;
const runFrom = Date.now();
while (Date.now() - runFrom < RUN_MS) {
  honest.ws.send(JSON.stringify({ t: "input", input: { seq: ++honest.seq, dx: 1, dz: 0, dt: 0.05 } }));
  cheat.ws.send(JSON.stringify({ t: "input", input: { seq: ++cheat.seq, dx: 1, dz: 0, dt: 0.1 } }));
  await wait(TICK_MS);
}
await wait(300);

const elapsed = (Date.now() - runFrom) / 1000;
const hd = Math.abs(self(honest).x - h0.x);
const cd = Math.abs(self(cheat).x - c0.x);

// Compare against WALL CLOCK, not against the honest client.
//
// The honest client is a JS loop on setTimeout, which drifts: it sends about
// 0.87 s of movement per real second, so measuring the cheater against it
// reports a 1.23x "advantage" that is really the baseline under-claiming. The
// only meaningful ceiling is physics: distance can never exceed elapsed real
// time x speed, plus the one banked burst the token bucket allows.
const PLAYER_SPEED = 4.0;
const BUCKET_MAX = 0.15;
const ceiling = (elapsed + BUCKET_MAX) * PLAYER_SPEED;
check(
  "sustained dt inflation cannot outrun the clock",
  cd <= ceiling,
  `inflated ${cd.toFixed(2)}m vs ${ceiling.toFixed(2)}m ceiling over ${elapsed.toFixed(2)}s (honest baseline ${hd.toFixed(2)}m)`
);
honest.ws.close();
cheat.ws.close();

a.ws.close();
b.ws.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
