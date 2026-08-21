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

import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { Population } from "./population.js";
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

/**
 * Movement budget as a TOKEN BUCKET, not a per-tick allowance.
 *
 * A flat per-tick allowance with slack for jitter hands that slack to anyone
 * who asks for it: an honest client claims the real elapsed time (0.05 s) while
 * a cheater claims the full allowance (0.0625 s) every single tick. Measured,
 * that is a permanent 1.25x speed advantage — smaller than the 2.00x it
 * replaced, but still free speed for lying.
 *
 * A bucket fixes it properly. Tokens accrue at EXACTLY real time: one second of
 * simulated movement per second of wall clock, no multiplier. Long-run speed is
 * therefore exactly 1.0x for everybody, and there is nothing to gain by
 * inflating dt.
 *
 * The burst cap is what still absorbs jitter: a client whose packets arrive
 * late has banked tokens and can spend them in a catch-up burst, so honest
 * players on bad connections are not punished. What it cannot do is let anyone
 * outrun the clock on average, which is the only property that matters.
 */
const BUCKET_FILL_PER_TICK = TICK_MS / 1000;
const BUCKET_MAX = 0.15; // ~3 ticks of banked catch-up

interface Player {
  id: PlayerId;
  name: string;
  socket: WebSocket;
  x: number;
  z: number;
  /** Last input seq applied. Echoed back so the client can reconcile. */
  ack: number;
  queue: Input[];
  /** Seconds of simulated movement this player may still spend. */
  budget: number;
}

const players = new Map<PlayerId, Player>();
let nextId = 1;
let tick = 0;

// Marrow's inhabitants. 60 is enough that the Commons reads as populated
// without the naive O(n) snapshot scan mattering yet.
const population = new Population(60);

// Marrow persists. Restore whatever was there, then live through however long
// the process was down before accepting the first connection — a player must
// never arrive mid-catch-up and watch the world lurch.
// Resolved to an ABSOLUTE path and logged. A relative default silently moves
// depending on how the process was launched — npm run --workspace sets cwd to
// the package, so "./world" landed in packages/server/world rather than the
// repo root. A persistent world that saves somewhere different depending on
// the launch command is not persistent.
const WORLD_DIR = path.resolve(process.env.ASHFALL_WORLD ?? "./world");
const boot = await population.attach(WORLD_DIR);
if (boot.restored) {
  const hours = ((boot.caughtUp * 12) / 3600).toFixed(1);
  console.log(
    `[ashfall] restored Marrow from ${WORLD_DIR} ` +
      (boot.caughtUp > 0
        ? `— simulated ${boot.caughtUp} ticks (${hours} world-hours) of absence`
        : "— no time had passed")
  );
} else {
  console.log(`[ashfall] no saved world at ${WORLD_DIR}; Marrow begins`);
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[ashfall] authoritative server listening on :${PORT}`);
console.log(`[ashfall] ${population.count} survivors in Marrow, world time ${(population.sim.worldTime / 3600).toFixed(1)}h`);

/**
 * Save on the way out.
 *
 * Without this, every clean shutdown loses up to 30 s of world — and worse,
 * the wall-clock stamp would be stale, so the next boot would fast-forward
 * through time the world had already lived. Idempotent because SIGINT can
 * arrive twice if someone is impatient.
 */
let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`
[ashfall] ${sig} — saving Marrow...`);
    population
      .save()
      .then(() => {
        console.log("[ashfall] world saved. Marrow persists.");
        process.exit(0);
      })
      .catch((e) => {
        console.error("[ashfall] SAVE FAILED:", e);
        process.exit(1);
      });
  });
}

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
        budget: BUCKET_FILL_PER_TICK,
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
    // Accrue at real time, capped. Unused tokens bank for a late burst.
    p.budget = Math.min(p.budget + BUCKET_FILL_PER_TICK, BUCKET_MAX);

    while (p.queue.length > 0 && p.budget > 0) {
      const input = p.queue.shift()!;

      /**
       * CLAMP TO THE REMAINING BUDGET *BEFORE* APPLYING.
       *
       * The previous version applied the whole input and only then subtracted
       * from the budget, so the per-input clamp (0.1 s) capped ONE input but
       * never the cumulative advance per tick. With a 0.0625 s budget, a client
       * sending dt=0.1 every tick advanced 0.1 s of movement per 0.05 s of real
       * time - a clean, sustained 2.00x speedhack, measured.
       *
       * It survived the whole suite because the existing test only checked a
       * SINGLE oversized input. One input being clamped says nothing about the
       * budget holding across a flood; those are different guarantees.
       *
       * Honest clients never reach this clamp, so their prediction still
       * reconciles exactly. Only a client trying to outrun the clock has its
       * inputs shortened - cheating costs accuracy, honesty costs nothing.
       *
       * The deeper fix is for the server to integrate from its OWN tick time
       * and the last known direction, never trusting client dt as movement time
       * at all. That changes the prediction contract, so it is noted rather
       * than snuck in here.
       */
      const dt = Math.min(Math.max(0, input.dt), 0.1, p.budget);
      applyInput(p, { ...input, dt }); // p has {x, z}; applyInput mutates them
      p.ack = input.seq;
      p.budget -= dt;
    }
  }

  // The population lives whether or not anyone is watching. That is the point:
  // shut off the water, log out, come back, and the consequences happened
  // without you.
  population.update(TICK_MS / 1000);

  const snapshot: PlayerState[] = [];
  for (const p of players.values()) {
    snapshot.push({ id: p.id, name: p.name, x: p.x, z: p.z, ack: p.ack });
  }

  const serverTime = Date.now();
  // Per-player snapshot, because the NPC list is culled to what that player
  // can plausibly see. Players are still broadcast wholesale — they are few,
  // and that is the next thing interest management will fix.
  for (const p of players.values()) {
    const msg: ServerMsg = {
      t: "snapshot",
      tick,
      serverTime,
      players: snapshot,
      npcs: population.snapshotFor(p),
    };
    send(p.socket, msg);
  }
}

loop();
