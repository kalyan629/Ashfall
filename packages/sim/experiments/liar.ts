/**
 * HONEST SOURCE vs TRUSTED LIAR — the revised E1.
 *
 *   node --import tsx experiments/liar.ts --rank 0 --world 32
 *
 * The original memory ablation asked "does episodic memory make a population
 * more correct?" and came back null. That was the wrong dependent variable:
 * memory's job is not to make an agent righter, it is to let an agent work out
 * WHO TO BELIEVE. So this measures that instead.
 *
 * Setup, held identical across memory modes:
 *
 *   LIAR    starts with high trust from everyone, and asserts falsehoods
 *   HONEST  starts distrusted, and asserts the truth
 *
 * Both push claims on the same schedule. The question is whether a population
 * can escape a well-liked liar, and whether memory is what lets it.
 *
 * Measured:
 *   accuracy        mean |credence - truth| over the contested propositions
 *   trustInLiar     has the population learned to discount them
 *   trustInHonest   has it learned to listen
 *   timeToDistrust  ticks until mean trust in the liar goes negative
 *   recovery        accuracy after the liar stops
 *
 * Sharded round-robin by --rank/--world so 72 cores can chew a seed sweep,
 * the same pattern the texture foundry uses. This is CPU work: the simulation
 * is branchy pointer-chasing over maps and would gain nothing from a GPU.
 */

import { createSim, step, tell, type Sim } from "../src/sim.js";
import type { MemoryMode } from "../src/agent.js";

const args = process.argv.slice(2);
const argOf = (k: string, d: number) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};

const RANK = argOf("rank", 0);
const WORLD = argOf("world", 1);
const SEEDS = argOf("seeds", 24);

const POP = 60;
const WARMUP = 300;
const CAMPAIGN = 2500; // liar and honest source both active
const AFTER = 1500; // liar goes quiet; can the population recover?

/** Propositions the two sources fight over. */
const CONTESTED = ["scrubber_broken", "l8_riches", "outside_alive"] as const;

function meanTrust(sim: Sim, who: string): number {
  let sum = 0;
  let n = 0;
  for (const a of sim.agents) {
    const t = a.trust.get(who);
    if (t !== undefined) {
      sum += t;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

function accuracy(sim: Sim): number {
  let err = 0;
  let n = 0;
  for (const a of sim.agents) {
    for (const id of CONTESTED) {
      const p = sim.props.find((x) => x.id === id)!;
      const b = a.beliefs.get(id);
      err += Math.abs((b?.credence ?? 0.5) - (p.truth ? 1 : 0));
      n++;
    }
  }
  return err / n;
}

interface Result {
  seed: number;
  mode: MemoryMode;
  observeRate: number;
  accuracy: number;
  accuracyAfterRecovery: number;
  trustInLiar: number;
  trustInHonest: number;
  timeToDistrust: number | null;
}

/**
 * Observation rates to sweep.
 *
 * THE KEY VARIABLE, discovered by the first run coming back degenerate: at a
 * very low rate the liar wins outright in every memory condition, because
 * detecting a lie requires having seen the truth. Memory cannot help you catch
 * a deceiver if you never independently learn anything — there is nothing to
 * reconcile the testimony against.
 *
 * So the real question is not "does memory beat lying" but:
 *
 *   How much independent access to ground truth does a population need before
 *   memory lets it detect systematic deception?
 *
 * That is a far better question, it has a curve rather than a yes/no, and it
 * is exactly the kind of thing a simulation with known truth can answer and
 * field data cannot.
 */
const OBSERVE_RATES = [0.0004, 0.002, 0.008, 0.03];

function run(seed: number, mode: MemoryMode, observeRate: number): Result {
  const sim = createSim({
    seed,
    population: POP,
    memoryMode: mode,
    logCapacity: 4000,
    // Rare, so testimony matters more than going to look. If observation is
    // cheap the social channel is irrelevant and both arms collapse together.
    investigateRate: observeRate,
  });

  const LIAR = "npc:aldous";
  const HONEST = "npc:wren";

  // Seed the asymmetry: the liar is well liked, the honest source is not.
  // This is the whole point — an honest source nobody trusts is the hard case.
  for (const a of sim.agents) {
    a.trust.set(LIAR, 0.75);
    a.trust.set(HONEST, -0.25);
  }

  for (let i = 0; i < WARMUP; i++) step(sim);

  let timeToDistrust: number | null = null;

  const campaign = (t: number) => {
    // Both sources work the room, targeting a rotating slice of the population.
    if (t % 25 === 0) {
      const target = sim.agents[(t / 25) % sim.agents.length].identity.id;
      const prop = CONTESTED[(t / 25) % CONTESTED.length];
      const truth = sim.props.find((x) => x.id === prop)!.truth;
      // The liar asserts the OPPOSITE of the world, confidently.
      tell(sim, target, prop, !truth, 0.9, LIAR);
    }
    if (t % 25 === 12) {
      const target = sim.agents[((t - 12) / 25) % sim.agents.length].identity.id;
      const prop = CONTESTED[((t - 12) / 25) % CONTESTED.length];
      const truth = sim.props.find((x) => x.id === prop)!.truth;
      tell(sim, target, prop, truth, 0.9, HONEST);
    }
  };

  for (let t = 0; t < CAMPAIGN; t++) {
    campaign(t);
    step(sim);
    if (timeToDistrust === null && meanTrust(sim, LIAR) < 0) timeToDistrust = t;
  }

  const acc = accuracy(sim);
  const tLiar = meanTrust(sim, LIAR);
  const tHonest = meanTrust(sim, HONEST);

  // The liar goes quiet. Does the population drift back toward the truth?
  for (let t = 0; t < AFTER; t++) step(sim);

  return {
    seed,
    mode,
    observeRate,
    accuracy: acc,
    accuracyAfterRecovery: accuracy(sim),
    trustInLiar: tLiar,
    trustInHonest: tHonest,
    timeToDistrust,
  };
}

const modes: MemoryMode[] = ["none", "shortTerm", "episodic"];
const results: Result[] = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  if (seed % WORLD !== RANK % WORLD) continue; // round-robin shard
  for (const mode of modes) {
    for (const rate of OBSERVE_RATES) results.push(run(seed, mode, rate));
  }
}

process.stdout.write(JSON.stringify(results) + "\n");
