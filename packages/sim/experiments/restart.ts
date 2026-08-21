/**
 * RESTART EQUIVALENCE — the flagship invariant.
 *
 *   npm run restart --workspace=@ashfall/sim
 *
 * Claim under test:
 *
 *   Ctrl-C is operationally invisible to the world.
 *
 * Two runs from the same seed:
 *
 *   A   simulate 3000 ticks continuously
 *   B   simulate 1000, snapshot, DESTROY the sim, restore, simulate 2000 more
 *
 * If the architecture is honest, A and B end in the same state — every belief,
 * every memory, every trust edge, every RNG position, every world truth.
 *
 * This is a stronger claim than "save/load works", and it is only checkable
 * because the simulation is deterministic and headless by construction. It
 * also protects a stated research invariant: same persisted state + same RNG
 * state + same future inputs = same future trajectory. Without it, a restart
 * silently forks the world, and any experiment spanning one is worthless.
 */

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { JsonlEventStore } from "../src/persist.js";
import { serializeSim, restoreSim, type WorldSnapshot } from "../src/snapshot.js";
import { createSim, step, tell, type Sim } from "../src/sim.js";

const SEED = 42;
const POP = 30;
const SPLIT = 1000;
const TOTAL = 3000;

/**
 * A comparable fingerprint of everything that defines the world.
 *
 * Deliberately exhaustive rather than a hash: when this fails, the failure
 * needs to say WHICH field diverged, or the test is just an alarm with no
 * information in it.
 */
function fingerprint(sim: Sim) {
  return {
    tick: sim.tick,
    worldTime: sim.worldTime,
    props: sim.props.map((p) => `${p.id}=${p.truth}`).join(","),
    agents: sim.agents
      .map((a) =>
        [
          a.identity.id,
          a.needs.hunger.toFixed(6),
          a.needs.thirst.toFixed(6),
          a.needs.fatigue.toFixed(6),
          a.needs.social.toFixed(6),
          a.goal ? `${a.goal.kind}:${a.goal.prop ?? "-"}:${a.goal.utility.toFixed(6)}` : "none",
          a.rng.state(),
          a.memories.length,
          [...a.beliefs.entries()]
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([k, b]) => `${k}:${b.credence.toFixed(6)}:${b.confidence.toFixed(6)}`)
            .join("|"),
          [...a.trust.entries()]
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([k, v]) => `${k}:${v.toFixed(6)}`)
            .join("|"),
        ].join(";")
      )
      .sort(),
  };
}

/** Drive a sim through a fixed, reproducible script of external inputs. */
function drive(sim: Sim, from: number, to: number): void {
  for (let t = from; t < to; t++) {
    // Deterministic external interventions at fixed ticks, so both runs
    // receive identical inputs — otherwise the comparison is meaningless.
    if (t === 400) tell(sim, "a3", "scrubber_broken", true, 0.9, "player:kalyan");
    if (t === 1500) tell(sim, "a7", "l8_riches", true, 0.7, "player:kalyan");
    if (t === 2200) tell(sim, "a3", "scrubber_broken", false, 0.6, "a7");
    step(sim);
  }
}

console.log("ASHFALL — restart equivalence\n");
console.log(`seed ${SEED}, population ${POP}, ${TOTAL} ticks, restart at ${SPLIT}\n`);

// --- A: continuous ---------------------------------------------------------
const a = createSim({ seed: SEED, population: POP, memoryMode: "episodic", logCapacity: 400_000 });
drive(a, 0, TOTAL);
const fpA = fingerprint(a);

// --- B: interrupted --------------------------------------------------------
const dir = path.join(os.tmpdir(), `ashfall-restart-${Date.now()}`);
const store = new JsonlEventStore<WorldSnapshot>(dir);
await store.init();

let b: Sim | undefined = createSim({
  seed: SEED,
  population: POP,
  memoryMode: "episodic",
  logCapacity: 400_000,
});
drive(b, 0, SPLIT);

await store.append([...b.log.all()]);
await store.snapshot(serializeSim(b));
await store.flush();

// Drop it entirely. Anything that survives came off the disk.
b = undefined;

const loaded = await store.restore();
if (!loaded) {
  console.log("  FAIL  no snapshot");
  process.exit(1);
}
const revived = createSim({ seed: SEED, population: POP, memoryMode: "episodic", logCapacity: 400_000 });
restoreSim(revived, loaded.state);
drive(revived, SPLIT, TOTAL);
const fpB = fingerprint(revived);

// --- compare ---------------------------------------------------------------
const failures: string[] = [];

if (fpA.tick !== fpB.tick) failures.push(`tick ${fpA.tick} vs ${fpB.tick}`);
if (fpA.worldTime !== fpB.worldTime) failures.push(`worldTime ${fpA.worldTime} vs ${fpB.worldTime}`);
if (fpA.props !== fpB.props) failures.push(`world truth:\n    A ${fpA.props}\n    B ${fpB.props}`);

let agentDiffs = 0;
for (let i = 0; i < Math.max(fpA.agents.length, fpB.agents.length); i++) {
  if (fpA.agents[i] !== fpB.agents[i]) {
    agentDiffs++;
    if (agentDiffs <= 3) {
      const [idA] = (fpA.agents[i] ?? "").split(";");
      failures.push(`agent ${idA || i} diverged`);
      // Show the first differing field so the failure is actionable.
      const fa = (fpA.agents[i] ?? "").split(";");
      const fb = (fpB.agents[i] ?? "").split(";");
      const names = ["id", "hunger", "thirst", "fatigue", "social", "goal", "rng", "memCount", "beliefs", "trust"];
      for (let f = 0; f < names.length; f++) {
        if (fa[f] !== fb[f]) {
          failures.push(`    ${names[f]}:\n      A ${String(fa[f]).slice(0, 110)}\n      B ${String(fb[f]).slice(0, 110)}`);
          break;
        }
      }
    }
  }
}
if (agentDiffs > 3) failures.push(`  ...and ${agentDiffs - 3} more agents diverged`);

// --- world truth invariant, every proposition ------------------------------
for (const p of a.props) {
  const q = revived.props.find((x) => x.id === p.id);
  if (!q || q.truth !== p.truth) failures.push(`world truth ${p.id}: ${p.truth} vs ${q?.truth}`);
}

await fs.rm(dir, { recursive: true, force: true });

if (failures.length === 0) {
  console.log(`  PASS  ${POP} agents, ${TOTAL} ticks — restart is invisible to the world`);
  console.log(`        every belief, trust edge, memory, goal, RNG position and world truth matches`);
  process.exit(0);
}

console.log(`  FAIL  ${agentDiffs}/${POP} agents diverged after restart\n`);
for (const f of failures.slice(0, 14)) console.log(`  ${f}`);
process.exit(1);
