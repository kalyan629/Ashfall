/**
 * ASHFALL authoritative server.
 *
 * The client asks; this decides. Everything a client sends is treated as a
 * *request*, validated, and applied by this process -- never trusted.
 *
 * Shape of the loop:
 *   1. Inputs arrive over the socket at whatever rate clients manage.
 *   2. They queue per-player.
 *   3. Every 50 ms (20 Hz) we drain each queue, apply the moves, and broadcast
 *      one snapshot of the whole room.
 *
 * Phase 0 broadcasts every player to every player, which is fine for a handful
 * and catastrophic for a thousand. Interest management (only send what is
 * within ~50 m) is Phase 7 and is the single most important scaling change
 * this file will ever get.
 */

import { WebSocketServer, type WebSocket } from "ws";
import {
  TICK_MS,
  applyInput,
  spawnPoint,
  type ClientMsg,
  type Input,
  type PlayerId,
  type PlayerState,
  type ServerMsg,
} from "@ashfall/shared";

const PORT = Number(process.env.PORT ?? 8080);

/** How much simulated time one player may advance per tick, in seconds.
 *
 *  This used to be a cap on the NUMBER of inputs drained (4 per tick), which is
 *  the wrong quantity to limit: it makes a client's speed depend on how often
 *  it happens to send, so a 240 fps client and a 7 fps client get different
 *  results from the same held key.
 *
 *  Budgeting by dt instead is both fairer and a strictly better speedhack
 *  guard -- what we actually care about is "you may not advance more than one
 *  tick of simulated time per tick of real time". The 1.25x slack absorbs
 *  network jitter and a client whose timer runs slightly fast, without letting
 *  anyone outrun the clock in a way that accumulates. */
const MAX_DT_PER_TICK = (TICK_MS / 1000) * 1.25;

interface Player {
  id: PlayerId;
  name: string;
  socket: WebSocket;
  x: number;
  z: number;
  /** Last input seq applied. Echoed back so the client can reconcile. */
  ack: number;
  queue: Input[];
}

const players = new Map<PlayerId, Player>();
let nextId = 1;
let tick = 0;

const wss = new WebSocketServer({ port: PORT });
console.log(`[ashfall] authoritative server listening on :${PORT}`);

wss.on("connection", (socket) => {
  const id = String(nextId++);
  let player: Player | null = null;

  socket.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      return; // malformed frames are ignored, never fatal
    }

    if (msg.t === "join") {
      if (player) return; // already joined; ignore duplicates
      const spawn = spawnPoint(Number(id));
      player = {
        id,
        // Trim and bound the name here. It is rendered by every other client,
        // so it is untrusted input arriving on someone else's screen.
        name: String(msg.name ?? "").slice(0, 16).trim() || `survivor-${id}`,
        socket,
        x: spawn.x,
        z: spawn.z,
        ack: 0,
        queue: [],
      };
      players.set(id, player);
      send(socket, { t: "welcome", id, tick });
      console.log(`[ashfall] ${player.name} (${id}) joined — ${players.size} in the bunker`);
      return;
    }

    if (msg.t === "input" && player) {
      // Drop out-of-order and replayed inputs outright. Accepting a seq we have
      // already applied would let a client re-run the same move repeatedly.
      if (!msg.input || msg.input.seq <= player.ack) return;
      // Bound the queue so a flooding client cannot exhaust memory.
      if (player.queue.length < 64) player.queue.push(msg.input);
    }
  });

  socket.on("close", () => {
    if (player) {
      players.delete(player.id);
      console.log(`[ashfall] ${player.name} (${player.id}) left — ${players.size} remain`);
    }
  });
});

function send(socket: WebSocket, msg: ServerMsg): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

/**
 * Fixed timestep. setInterval drifts, so we track the deadline explicitly and
 * catch up when the event loop runs late. Simulation must never depend on how
 * punctual the timer was.
 */
let next = Date.now();

function loop(): void {
  const now = Date.now();

  while (now >= next) {
    step();
    next += TICK_MS;

    // If we somehow fall more than a second behind, give up on catching up
    // rather than spiralling. Better one visible hitch than a death spiral.
    if (Date.now() - next > 1000) {
      console.warn("[ashfall] tick budget blown; resyncing clock");
      next = Date.now();
      break;
    }
  }

  setTimeout(loop, Math.max(0, next - Date.now()));
}

function step(): void {
  tick++;

  for (const p of players.values()) {
    // Drain by simulated-time budget, not by input count. Leftover inputs stay
    // queued and are applied next tick, so a burst is delayed rather than lost.
    let budget = MAX_DT_PER_TICK;
    while (p.queue.length > 0 && budget > 0) {
      const input = p.queue.shift()!;
      applyInput(p, input); // p has {x, z}; applyInput mutates them
      p.ack = input.seq;
      // applyInput clamps dt to 0.1 internally; mirror that here so a client
      // claiming a huge dt cannot drain the whole budget in one input.
      budget -= Math.max(0, Math.min(input.dt, 0.1));
    }
  }

  const snapshot: PlayerState[] = [];
  for (const p of players.values()) {
    snapshot.push({ id: p.id, name: p.name, x: p.x, z: p.z, ack: p.ack });
  }

  const msg: ServerMsg = {
    t: "snapshot",
    tick,
    serverTime: Date.now(),
    players: snapshot,
  };
  for (const p of players.values()) send(p.socket, msg);
}

loop();
