/**
 * PERSISTENCE ROUND-TRIP.
 *
 *   npm run persist --workspace=@ashfall/sim
 *
 * The demo that matters: change the world, save, DESTROY the simulation
 * entirely, restore from disk, and prove the survivors remember.
 *
 * Exits non-zero on any mismatch, so this is CI-able. A persistence layer that
 * is not continuously verified is a persistence layer that silently stopped
 * saving one of its fields three commits ago.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { JsonlEventStore } from "../src/persist.js";
import { serializeSim, restoreSim, type WorldSnapshot } from "../src/snapshot.js";
import { createSim, setWorldTruth, step, tell } from "../src/sim.js";

const dir = path.join(os.tmpdir(), `ashfall-persist-${Date.now()}`);
const store = new JsonlEventStore<WorldSnapshot>(dir);
await store.init();

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

console.log("ASHFALL — persistence round trip\n");
console.log(`store: ${dir}\n`);

// --- live world ------------------------------------------------------------
let sim = createSim({ seed: 21, population: 40, memoryMode: "episodic", logCapacity: 500_000 });
for (let i = 0; i < 600; i++) step(sim);

// An intervention with consequences: tell somebody something, and break the world.
tell(sim, "a5", "scrubber_broken", true, 0.9, "player:kalyan");
setWorldTruth(sim, "outside_alive", true, "player:kalyan");
for (let i = 0; i < 900; i++) step(sim);

const beforeAgents = sim.agents.length;
const beforeTick = sim.tick;
const beforeWorldTime = sim.worldTime;
const beforeBelief = sim.byId.get("a5")!.beliefs.get("scrubber_broken")!.credence;
const beforeTrust = sim.byId.get("a5")!.trust.get("player:kalyan");
const beforeMemories = sim.agents.reduce((n, a) => n + a.memories.length, 0);
const beforeRngA5 = sim.byId.get("a5")!.rng.state();
const beforeOutside = sim.props.find((p) => p.id === "outside_alive")!.truth;

await store.append([...sim.log.all()]);
await store.snapshot(serializeSim(sim));
await store.flush();

// --- destroy it ------------------------------------------------------------
// Not a reset — the object is dropped entirely, exactly as a process exit
// would. Anything that survives has genuinely come off the disk.
sim = undefined as never;

// --- restore ---------------------------------------------------------------
const loaded = await store.restore();
check("snapshot found", loaded !== null);
if (!loaded) process.exit(1);

const revived = createSim({ seed: 999, population: 1 }); // deliberately WRONG shape
restoreSim(revived, loaded.state);

check("agent count", revived.agents.length === beforeAgents, `${revived.agents.length} vs ${beforeAgents}`);
check("tick", revived.tick === beforeTick, `${revived.tick} vs ${beforeTick}`);
check("world time", revived.worldTime === beforeWorldTime, `${revived.worldTime}s`);

const a5 = revived.byId.get("a5");
check("agent lookup rebuilt", !!a5);
check(
  "beliefs survived (Map round trip)",
  !!a5 && Math.abs((a5.beliefs.get("scrubber_broken")?.credence ?? -1) - beforeBelief) < 1e-9,
  `credence ${a5?.beliefs.get("scrubber_broken")?.credence?.toFixed(4)} vs ${beforeBelief.toFixed(4)}`
);
check(
  "trust in the player survived",
  !!a5 && a5.trust.get("player:kalyan") === beforeTrust,
  `${a5?.trust.get("player:kalyan")?.toFixed(3)} vs ${beforeTrust?.toFixed(3)}`
);
check(
  "memories survived",
  revived.agents.reduce((n, a) => n + a.memories.length, 0) === beforeMemories,
  `${revived.agents.reduce((n, a) => n + a.memories.length, 0)} vs ${beforeMemories}`
);
check(
  "WORLD truth survived, not just belief about it",
  revived.props.find((p) => p.id === "outside_alive")!.truth === beforeOutside,
  `outside_alive=${revived.props.find((p) => p.id === "outside_alive")!.truth}`
);
check(
  "RNG resumed mid-sequence, not reseeded",
  !!a5 && a5.rng.state() === beforeRngA5,
  `state ${a5?.rng.state()} vs ${beforeRngA5}`
);
check("social graph survived", revived.graph.size === beforeAgents, `${revived.graph.size} nodes`);

// --- durable event log -----------------------------------------------------
let replayed = 0;
let sawIntervention = false;
for await (const rec of store.read(0)) {
  replayed++;
  if (rec.event.t === "world_changed" && rec.event.prop === "outside_alive") sawIntervention = true;
}
check("durable events replayed", replayed > 0, `${replayed} records`);
check("the player intervention is in the history", sawIntervention);

// --- the firehose is NOT on disk -------------------------------------------
const logBytes = (await fs.stat(path.join(dir, "events.jsonl")).catch(() => ({ size: 0 }))).size;
const snapBytes = (await fs.stat(path.join(dir, "snapshot.json"))).size;
check(
  "cognitive churn was filtered out",
  replayed < 5000,
  `${replayed} durable of ${1500 * 40} agent-ticks simulated`
);

// --- truncated final record ------------------------------------------------
// Simulate a crash during append and prove restore survives it.
await fs.appendFile(path.join(dir, "events.jsonl"), '{"seq":99999,"v":1,"eve', "utf8");
let survivedTruncation = true;
try {
  for await (const _ of store.read(0)) void _;
} catch {
  survivedTruncation = false;
}
check("truncated final record is dropped, not fatal", survivedTruncation);

console.log(`\n  events.jsonl ${(logBytes / 1024).toFixed(1)} KB   snapshot.json ${(snapBytes / 1024).toFixed(1)} KB`);

await fs.rm(dir, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n  ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
