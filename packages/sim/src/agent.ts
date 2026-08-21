/**
 * A survivor of Marrow.
 *
 * The architecture is the one from the brief — identity / needs / knowledge /
 * memory / goals / decision — with one addition that matters for research:
 * every subsystem is separately switchable, because the experiments are
 * ABLATIONS. `MemoryMode` is not a feature flag, it is an independent variable.
 */

import type { Goal } from "./goals.js";
import {
  type Belief,
  type Memory,
  type Rng,
  type RetrievalWeights,
  DEFAULT_RETRIEVAL,
  clamp01,
  gauss,
  retrievalScore,
  unknownBelief,
} from "./core.js";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type Occupation = "scrubber" | "grower" | "digger" | "trader" | "custody" | "idle";

export interface Identity {
  id: string;
  name: string;
  occupation: Occupation;
  faction: string;
  /** Big-five-ish, 0..1. Only the traits that change behaviour are modelled. */
  personality: {
    /** How readily they believe what they are told. */
    credulity: number;
    /** How much they talk. Drives gossip out-degree. */
    sociability: number;
    /** Tolerance for the deep. Drives whether they go and find out. */
    boldness: number;
    /** How much they distort a rumour when passing it on. */
    embellishment: number;
  };
}

// ---------------------------------------------------------------------------
// Needs
// ---------------------------------------------------------------------------

export interface Needs {
  hunger: number;
  thirst: number;
  fatigue: number;
  safety: number;
  social: number;
}

/** All needs drift toward unmet. Rates are per tick, tuned per-need because
 *  thirst should bite before hunger and fatigue before either. */
const DECAY: Needs = {
  hunger: 0.0009,
  thirst: 0.0016,
  fatigue: 0.0012,
  safety: 0.0004,
  social: 0.0007,
};

export function decayNeeds(n: Needs): void {
  n.hunger = clamp01(n.hunger + DECAY.hunger);
  n.thirst = clamp01(n.thirst + DECAY.thirst);
  n.fatigue = clamp01(n.fatigue + DECAY.fatigue);
  n.safety = clamp01(n.safety + DECAY.safety);
  n.social = clamp01(n.social + DECAY.social);
}

/** The need most in want of attention, and how badly. */
export function dominantNeed(n: Needs): { need: keyof Needs; pressure: number } {
  let best: keyof Needs = "hunger";
  let pressure = -1;
  for (const k of Object.keys(n) as (keyof Needs)[]) {
    if (n[k] > pressure) {
      pressure = n[k];
      best = k;
    }
  }
  return { need: best, pressure };
}

// ---------------------------------------------------------------------------
// Memory modes — the ablation
// ---------------------------------------------------------------------------

/**
 * The independent variable for the memory experiment.
 *
 *  none      — no episodic store at all. Beliefs still update, but nothing is
 *              recalled, so the agent cannot notice it has been lied to before.
 *  shortTerm — a small ring buffer, aggressive forgetting.
 *  episodic  — full store with importance-weighted retention and consolidation.
 */
export type MemoryMode = "none" | "shortTerm" | "episodic";

export interface MemoryConfig {
  mode: MemoryMode;
  capacity: number;
  /** Ticks for a memory's recency score to halve. */
  halfLife: number;
  weights: RetrievalWeights;
}

export const MEMORY_PRESETS: Record<MemoryMode, MemoryConfig> = {
  none: { mode: "none", capacity: 0, halfLife: 1, weights: DEFAULT_RETRIEVAL },
  shortTerm: { mode: "shortTerm", capacity: 12, halfLife: 300, weights: DEFAULT_RETRIEVAL },
  episodic: { mode: "episodic", capacity: 240, halfLife: 4000, weights: DEFAULT_RETRIEVAL },
};

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

export interface Agent {
  identity: Identity;
  needs: Needs;
  beliefs: Map<string, Belief>;
  memories: Memory[];
  /** Directed trust toward other agents, -1..1. The social graph. */
  trust: Map<string, number>;
  /** Where in Marrow they are, as a level index 1..8. */
  level: number;
  memCfg: MemoryConfig;
  /** Simulation LOD tier this agent is currently being run at. */
  tier: 0 | 1 | 2 | 3;
  /** What this survivor is currently trying to do, and how much they want it. */
  goal: Goal | null;
  /**
   * Per-proposition id of the last `belief_updated` event for this agent.
   *
   * Exists purely so a goal driven by a belief can be emitted as a causal
   * CHILD of the belief change that drove it. Without it the audit sees a
   * belief update and a goal change as unrelated roots, reports the belief
   * stage as dead, and is right to: an untraceable causal claim is not a
   * causal claim.
   */
  lastBeliefEvent: Map<string, number>;
  rng: Rng;
  /** Monotonic id source for memories. */
  nextMemId: number;
}

export function believe(a: Agent, propId: string, tick: number): Belief {
  let b = a.beliefs.get(propId);
  if (!b) {
    b = unknownBelief(tick);
    a.beliefs.set(propId, b);
  }
  return b;
}

export function trustIn(a: Agent, other: string): number {
  return a.trust.get(other) ?? 0;
}

// ---------------------------------------------------------------------------
// Belief update
// ---------------------------------------------------------------------------

/**
 * Update a belief from testimony.
 *
 * This is the heart of the whole system, so it is worth being explicit about
 * what it is and is not. It is a trust-weighted pull toward the claim, not a
 * strict Bayesian update — a real posterior needs a likelihood model the agent
 * does not have. What it does capture, and what a boolean "knows/doesn't know"
 * flag cannot:
 *
 *   - Testimony from a distrusted source moves you AWAY from their claim.
 *     Being told something by a known liar is evidence, just not the evidence
 *     they intended.
 *   - Confidence gates plasticity. A firmly held belief barely moves; an
 *     uncertain one flips easily. This produces stubbornness without scripting.
 *   - Corroboration compounds, which means a rumour repeated by three people
 *     who all heard it from ONE person still hardens the belief. That is a
 *     real epistemic failure mode and the simulation should reproduce it.
 */
export function updateFromTestimony(
  a: Agent,
  propId: string,
  claim: boolean,
  claimConfidence: number,
  from: string,
  tick: number
): void {
  const b = believe(a, propId, tick);
  const t = trustIn(a, from);

  // Distrust inverts the pull. |t| scales how much this source matters at all.
  const direction = t >= 0 ? (claim ? 1 : 0) : claim ? 0 : 1;
  const sourceWeight = Math.abs(t) * 0.6 + 0.4; // strangers still carry some weight

  // Plasticity: how much this agent will move. Credulous and unconfident
  // agents move a lot; confident sceptics barely at all.
  const plasticity =
    a.identity.personality.credulity * (1 - b.confidence) * claimConfidence * sourceWeight;

  b.credence = clamp01(b.credence + (direction - b.credence) * clamp01(plasticity));

  // Hearing the same thing again hardens it, with diminishing returns.
  b.corroborations += 1;
  const hardening = 0.10 * claimConfidence * sourceWeight;
  b.confidence = clamp01(b.confidence + hardening * (1 - b.confidence));

  b.lastUpdated = tick;
  b.source = from;
}

/**
 * Update from direct observation. Strong, and confidence goes high — this is
 * the only route to actually knowing something, and it is why `boldness`
 * matters: the agents willing to go to Level 8 are the ones who seed truth
 * into the population.
 */
export function updateFromObservation(
  a: Agent,
  propId: string,
  observed: boolean,
  tick: number,
  fidelity = 0.92
): void {
  const b = believe(a, propId, tick);
  const target = observed ? 1 : 0;
  b.credence = clamp01(b.credence + (target - b.credence) * fidelity);
  b.confidence = clamp01(b.confidence + fidelity * (1 - b.confidence));
  b.lastUpdated = tick;
  b.source = "self";
  b.corroborations += 2;
}

/**
 * Confidence bleeds away with time; credence drifts back toward uncertainty.
 * Without this, one overheard rumour would define an agent forever.
 *
 * `elapsed` is ticks since this belief was LAST DECAYED, not since it was last
 * updated. The distinction is not pedantic — the first version of this took
 * `tick` and computed `age = tick - b.lastUpdated` without advancing
 * lastUpdated, so every tick re-applied decay for the belief's entire age:
 * 0.5^(1/h) * 0.5^(2/h) * ... = 0.5^(N^2/2h). Quadratic instead of
 * exponential. Every belief in the population collapsed to "no idea" within a
 * few hundred ticks, which silently flattened all three arms of the memory
 * ablation to the same number and made the whole simulation look like a null
 * result. A decay bug is indistinguishable from "the hypothesis is false".
 */
export function decayBelief(b: Belief, elapsed: number, halfLife: number): void {
  if (elapsed <= 0) return;
  const keep = Math.pow(0.5, elapsed / halfLife);
  b.confidence *= keep;
  b.credence = 0.5 + (b.credence - 0.5) * keep;
}

// ---------------------------------------------------------------------------
// Memory operations
// ---------------------------------------------------------------------------

export function remember(a: Agent, m: Omit<Memory, "id">): void {
  if (a.memCfg.mode === "none") return;

  a.memories.push({ ...m, id: a.nextMemId++ });

  if (a.memories.length > a.memCfg.capacity) {
    if (a.memCfg.mode === "shortTerm") {
      // Pure recency: the oldest goes, regardless of how much it mattered.
      a.memories.shift();
    } else {
      // Episodic: consolidation. Drop the least important thing, not the
      // oldest — which is what lets a significant event survive for weeks.
      let worst = 0;
      let worstScore = Infinity;
      for (let i = 0; i < a.memories.length; i++) {
        const m2 = a.memories[i];
        const s = m2.importance + Math.abs(m2.valence) * 0.5;
        if (s < worstScore) {
          worstScore = s;
          worst = i;
        }
      }
      a.memories.splice(worst, 1);
    }
  }
}

/** Recall the top-k memories for a cue. Empty for `none`, by construction. */
export function recall(
  a: Agent,
  now: number,
  cue: { about?: string; participants?: string[] },
  k = 3
): Memory[] {
  if (a.memCfg.mode === "none" || a.memories.length === 0) return [];
  return a.memories
    .map((m) => ({ m, s: retrievalScore(m, now, cue, a.memCfg.halfLife, a.memCfg.weights) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, k)
    .map((x) => x.m);
}

/**
 * What an agent will SAY about a proposition, which is not the same as what it
 * believes. Embellishment pushes the claim toward the extreme and inflates
 * stated confidence — this is where rumours drift as they travel.
 */
export function testify(
  a: Agent,
  propId: string,
  tick: number
): { claim: boolean; confidence: number } | null {
  const b = a.beliefs.get(propId);
  // Nothing to say if you have no opinion worth voicing.
  if (!b || b.confidence < 0.08) return null;

  const emb = a.identity.personality.embellishment;
  const stated = clamp01(b.credence + gauss(a.rng, 0, 0.08 * emb));
  return {
    claim: stated >= 0.5,
    // People overstate how sure they are, in proportion to embellishment.
    confidence: clamp01(b.confidence * (1 + 0.5 * emb)),
  };
}
