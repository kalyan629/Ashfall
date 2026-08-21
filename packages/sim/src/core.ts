/**
 * ASHFALL simulation core — deterministic primitives.
 *
 * DESIGN CONSTRAINT ABOVE ALL OTHERS: this package must run headless, with no
 * server, no browser, and no clock. An experiment that can only be observed by
 * playing the game is not an experiment. Every run is a pure function of
 * (seed, config), so a result can be reproduced exactly months later — which
 * is the difference between a demo and a finding.
 *
 * Corollary: nothing in here may call Math.random(), Date.now(), or touch I/O.
 */

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

/**
 * mulberry32. Small, fast, and — the only property that matters here —
 * reproducible from a seed across machines and Node versions.
 *
 * Every stochastic decision in the simulation draws from an explicit RNG that
 * was handed to it. There is no global random. That is deliberate: it means a
 * single agent's behaviour can be replayed in isolation.
 */
export interface Rng {
  (): number;
  /**
   * Current internal state.
   *
   * Exposed because a persistent world must restore DETERMINISM, not just
   * data. Reloading agents with their beliefs intact but their generators
   * reset to the seed would make every survivor re-run the same random
   * sequence they already lived through — identical "coin flips" after every
   * server restart. The state is one 32-bit word; it is the cheapest possible
   * thing to persist and the whole replay guarantee rests on it.
   */
  state(): number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const rng = function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  } as Rng;
  rng.state = () => a >>> 0;
  return rng;
}

export function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

/** Box-Muller, for noise that should be normal rather than uniform. */
export function gauss(rng: Rng, mean = 0, sd = 1): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------
// Propositions — the things agents can hold beliefs about
// ---------------------------------------------------------------------------

/**
 * A proposition is a claim about the world with a definite truth value that
 * the SIMULATION knows and the AGENTS do not.
 *
 * This asymmetry is the whole point. Marrow's population believes one thing
 * while the world is another way (docs/WORLD.md 2), and making that an AI
 * mechanic rather than backstory is what turns the game into an instrument:
 * because ground truth is known by construction, belief accuracy is directly
 * measurable — which is exactly what you can never do with real social data.
 */
export interface Proposition {
  id: string;
  /** What is actually the case. Agents never read this. */
  truth: boolean;
  /** How much this matters, 0..1 — drives how eagerly it is gossiped. */
  salience: number;
  label: string;
}

/**
 * One agent's stance on one proposition.
 *
 * Note this is NOT a boolean. An agent holds a credence and a confidence, and
 * the two come apart: you can be confidently wrong, or correctly unsure. Most
 * game "knowledge" systems collapse this to a flag and lose every interesting
 * behaviour in the process.
 */
export interface Belief {
  /** Subjective probability the proposition is TRUE, 0..1. */
  credence: number;
  /** How firmly held, 0..1. Low confidence updates easily. */
  confidence: number;
  /** Sim tick when last updated — drives decay toward uncertainty. */
  lastUpdated: number;
  /** Who this was heard from, for provenance and distrust propagation. */
  source: string | null;
  /** How many independent-seeming corroborations have been heard. */
  corroborations: number;
}

export function unknownBelief(tick: number): Belief {
  // 0.5 credence, ~0 confidence: "no idea, and I know I have no idea".
  return { credence: 0.5, confidence: 0.02, lastUpdated: tick, source: null, corroborations: 0 };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/**
 * An episodic memory.
 *
 * The brief asked for memory that is an AI system rather than an Event[], and
 * the operative difference is RETRIEVAL: a memory that cannot be selectively
 * recalled is just a log. Retrieval here scores on recency, importance and
 * relevance — the standard triad from the generative-agents literature — and
 * adds emotional weight, which makes recall biased rather than merely lossy.
 *
 * Deliberately NOT stored: exact timestamps as presentable facts. An agent
 * knows roughly how long ago and how sure it is, not "14:32 on day 17".
 */
export interface Memory {
  id: number;
  tick: number;
  kind: "helped" | "harmed" | "traded" | "witnessed" | "told" | "shortage";
  /** Free-text-ish key for what it was about; may name a proposition. */
  about: string;
  /** Other agents involved. */
  participants: string[];
  where: string;
  /** 0..1 — how much this mattered at encoding time. */
  importance: number;
  /** -1..1 — negative memories are stickier, as in humans. */
  valence: number;
  /** 0..1 — degrades over time; low confidence memories misreport details. */
  confidence: number;
}

/**
 * Retrieval score. Higher is more likely to come to mind.
 *
 * The weights are a starting point, not a finding. They are exposed here
 * rather than buried so an experiment can sweep them — "which retrieval
 * weighting produces the most behaviourally consistent agent" is a question
 * this codebase should be able to answer empirically.
 */
export interface RetrievalWeights {
  recency: number;
  importance: number;
  relevance: number;
  emotion: number;
}

export const DEFAULT_RETRIEVAL: RetrievalWeights = {
  recency: 1.0,
  importance: 1.0,
  relevance: 1.6,
  emotion: 0.6,
};

/** Exponential forgetting curve; halfLife is in ticks. */
export function recencyScore(now: number, then: number, halfLife: number): number {
  return Math.pow(0.5, (now - then) / halfLife);
}

export function retrievalScore(
  m: Memory,
  now: number,
  cue: { about?: string; participants?: string[] },
  halfLife: number,
  w: RetrievalWeights = DEFAULT_RETRIEVAL
): number {
  let relevance = 0;
  if (cue.about && m.about === cue.about) relevance += 1;
  if (cue.participants?.length) {
    const hit = cue.participants.some((p) => m.participants.includes(p));
    if (hit) relevance += 1;
  }
  return (
    w.recency * recencyScore(now, m.tick, halfLife) +
    w.importance * m.importance +
    w.relevance * relevance +
    w.emotion * Math.abs(m.valence)
  );
}
