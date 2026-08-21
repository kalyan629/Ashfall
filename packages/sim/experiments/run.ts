/**
 * ASHFALL simulation experiments.
 *
 *   npm run exp --workspace=@ashfall/sim
 *
 * Three questions, each with the control it needs to be worth answering:
 *
 *  E1  MEMORY ABLATION. Does episodic memory change population-level belief
 *      accuracy, or only individual behaviour? Independent variable is
 *      MemoryMode; everything else is held on the same seeds.
 *
 *  E2  SIMULATION LOD. How far can per-agent fidelity be degraded before
 *      aggregate outcomes diverge from a full-fidelity reference run on the
 *      SAME SEED? Reports both divergence and the compute saved, because the
 *      answer is a cost/accuracy curve.
 *
 *  E3  NULL MODEL FOR STRUCTURE. Faction polarisation is compared against a
 *      degree-preserving random rewire. If polarisation survives the shuffle,
 *      it was never about factions — that comparison is what separates a
 *      finding from a screenshot of clusters.
 *
 * Every number below is reproducible: same seeds in, same numbers out.
 */

import { createSim, measure, step, type Metrics, type SimConfig } from "../src/sim.js";
import type { MemoryMode } from "../src/agent.js";

const TICKS = 6000;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function run(cfg: Partial<SimConfig>, ticks = TICKS): { sim: ReturnType<typeof createSim>; final: Metrics } {
  const sim = createSim(cfg);
  for (let i = 0; i < ticks; i++) step(sim);
  return { sim, final: measure(sim) };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(xs.length - 1, 1));
};
const pm = (xs: number[], d = 3) => `${mean(xs).toFixed(d)} ±${sd(xs).toFixed(d)}`;

console.log(`ASHFALL simulation experiments`);
console.log(`population=100  ticks=${TICKS}  seeds=${SEEDS.length}\n`);

// --- E1: memory ablation ---------------------------------------------------
console.log("E1  MEMORY ABLATION — does episodic memory change belief outcomes?");
console.log("    " + "mode".padEnd(12) + "beliefError".padEnd(18) + "confidentlyWrong".padEnd(20) + "informed");

const e1: Record<string, Metrics[]> = {};
for (const mode of ["none", "shortTerm", "episodic"] as MemoryMode[]) {
  const rows = SEEDS.map((seed) => run({ seed, memoryMode: mode }).final);
  e1[mode] = rows;
  console.log(
    "    " +
      mode.padEnd(12) +
      pm(rows.map((r) => r.beliefError)).padEnd(18) +
      pm(rows.map((r) => r.confidentlyWrong)).padEnd(20) +
      pm(rows.map((r) => r.informed))
  );
}

// --- E2: simulation LOD ----------------------------------------------------
console.log("\nE2  SIMULATION LOD — fidelity vs compute, same seeds");
console.log("    " + "lod".padEnd(12) + "beliefError".padEnd(18) + "agentUpdates".padEnd(16) + "conversations");

const full = SEEDS.map((seed) => run({ seed, lod: "full" }).final);
const tiered = SEEDS.map((seed) => run({ seed, lod: "tiered" }).final);

for (const [label, rows] of [["full", full], ["tiered", tiered]] as const) {
  console.log(
    "    " +
      label.padEnd(12) +
      pm(rows.map((r) => r.beliefError)).padEnd(18) +
      Math.round(mean(rows.map((r) => r.agentUpdates))).toLocaleString().padEnd(16) +
      Math.round(mean(rows.map((r) => r.conversations))).toLocaleString()
  );
}

const divergence = mean(SEEDS.map((_, i) => Math.abs(tiered[i].beliefError - full[i].beliefError)));
const costRatio = mean(tiered.map((r) => r.agentUpdates)) / mean(full.map((r) => r.agentUpdates));
console.log(`\n    divergence in beliefError : ${divergence.toFixed(4)}`);
console.log(`    compute vs full           : ${(costRatio * 100).toFixed(1)}%`);
console.log(`    -> ${(1 / costRatio).toFixed(1)}x cheaper for ${divergence.toFixed(4)} error drift`);

// --- E3: null model --------------------------------------------------------
console.log("\nE3  NULL MODEL — is polarisation actually caused by faction structure?");
console.log("    " + "graph".padEnd(12) + "factionPolarisation");

const structured = SEEDS.map((seed) => run({ seed, shuffleGraph: false }).final);
const shuffled = SEEDS.map((seed) => run({ seed, shuffleGraph: true }).final);

console.log("    " + "homophilic".padEnd(12) + pm(structured.map((r) => r.factionPolarisation), 4));
console.log("    " + "shuffled".padEnd(12) + pm(shuffled.map((r) => r.factionPolarisation), 4));

const sMean = mean(structured.map((r) => r.factionPolarisation));
const nMean = mean(shuffled.map((r) => r.factionPolarisation));
const pooled = Math.sqrt(
  (sd(structured.map((r) => r.factionPolarisation)) ** 2 +
    sd(shuffled.map((r) => r.factionPolarisation)) ** 2) / 2
);
console.log(`\n    effect size (Cohen's d)   : ${((sMean - nMean) / Math.max(pooled, 1e-9)).toFixed(2)}`);
console.log(
  `    verdict                   : ${
    sMean > nMean * 1.5
      ? "structure matters — polarisation collapses without homophily"
      : "NOT SUPPORTED — polarisation survives the shuffle, so it is not faction-driven"
  }`
);

// --- belief trajectory for one seed ---------------------------------------
console.log("\nTRAJECTORY (seed=1, episodic) — how truth spreads");
console.log("    " + "tick".padEnd(8) + "beliefError".padEnd(14) + "confWrong".padEnd(12) + "informed");
{
  const sim = createSim({ seed: 1, memoryMode: "episodic" });
  for (let t = 0; t <= TICKS; t++) {
    if (t % 1000 === 0) {
      const m = measure(sim);
      console.log(
        "    " +
          String(t).padEnd(8) +
          m.beliefError.toFixed(4).padEnd(14) +
          m.confidentlyWrong.toFixed(4).padEnd(12) +
          m.informed.toFixed(3)
      );
    }
    step(sim);
  }
}
