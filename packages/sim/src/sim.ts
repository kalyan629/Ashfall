/**
 * The Marrow simulation.
 *
 * Headless, deterministic, and measurable. Given the same seed and config it
 * produces bit-identical output, which is what makes ablations meaningful.
 *
 * Two research affordances are built in from the start rather than retrofitted:
 *
 *  1. GROUND TRUTH IS KNOWN. Propositions carry a real truth value the agents
 *     never see, so belief accuracy is directly measurable. This is precisely
 *     what cannot be done with real social data, where the true latent belief
 *     is exactly the thing you are trying to estimate.
 *
 *  2. SIMULATION LOD IS AN EXPLICIT KNOB. Agents run at one of four fidelity
 *     tiers. The research question is how far fidelity can be degraded before
 *     aggregate outcomes diverge from a full-fidelity reference run on the
 *     same seed — a cost/accuracy curve, not a vibe.
 */

import { type Proposition, type Rng, clamp01, makeRng, pick } from "./core.js";
import {
  type Agent,
  type Identity,
  type MemoryMode,
  type Occupation,
  MEMORY_PRESETS,
  believe,
  decayBelief,
  decayNeeds,
  recall,
  remember,
  testify,
  trustIn,
  updateFromObservation,
  updateFromTestimony,
} from "./agent.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SimConfig {
  seed: number;
  population: number;
  memoryMode: MemoryMode;
  /** Conversations attempted per agent per tick, before tier throttling. */
  chattiness: number;
  /** Chance per tick a bold agent goes and looks at a deep proposition. */
  investigateRate: number;
  /** Ticks for belief confidence to halve without reinforcement. */
  beliefHalfLife: number;
  /** Simulation LOD. "full" runs every agent every tick. */
  lod: LodMode;
  /**
   * NULL MODEL. When true the social graph is rewired at random while
   * preserving degree, destroying faction structure but keeping density.
   * Any "factions caused this" claim must survive comparison against it.
   */
  shuffleGraph: boolean;
}

export type LodMode = "full" | "tiered";

export const DEFAULT_CONFIG: SimConfig = {
  seed: 1,
  population: 100,
  memoryMode: "episodic",
  chattiness: 1.2,
  investigateRate: 0.004,
  beliefHalfLife: 9000,
  lod: "full",
  shuffleGraph: false,
};

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface Sim {
  cfg: SimConfig;
  rng: Rng;
  tick: number;
  agents: Agent[];
  byId: Map<string, Agent>;
  props: Proposition[];
  /** Undirected adjacency: who talks to whom. */
  graph: Map<string, string[]>;
  /** Per-tick cost accounting, for the LOD cost/accuracy curve. */
  work: { agentUpdates: number; conversations: number };
}

const FACTIONS = ["directorate", "cut", "grow", "works", "unaffiliated"] as const;
const OCCUPATIONS: Occupation[] = ["scrubber", "grower", "digger", "trader", "custody", "idle"];

/** The propositions Marrow argues about. Truth is fixed and hidden from agents. */
export function defaultPropositions(): Proposition[] {
  return [
    { id: "l8_creature", truth: true, salience: 0.95, label: "Something lives on Level 8" },
    { id: "l8_ward", truth: true, salience: 0.9, label: "A ward is hidden in the Sumps" },
    { id: "l8_riches", truth: false, salience: 0.7, label: "Level 8 is full of salvage" },
    { id: "gate_openable", truth: true, salience: 0.85, label: "The Gate can be opened" },
    { id: "directorate_knew", truth: true, salience: 0.8, label: "The Directorate knew beforehand" },
    { id: "outside_alive", truth: false, salience: 0.6, label: "Other shelters still answer" },
  ];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createSim(partial: Partial<SimConfig> = {}): Sim {
  const cfg = { ...DEFAULT_CONFIG, ...partial };
  const rng = makeRng(cfg.seed);
  const agents: Agent[] = [];

  for (let i = 0; i < cfg.population; i++) {
    const faction = FACTIONS[Math.floor(rng() * FACTIONS.length)];
    const identity: Identity = {
      id: `a${i}`,
      name: `survivor-${i}`,
      occupation: pick(rng, OCCUPATIONS),
      faction,
      personality: {
        credulity: 0.15 + rng() * 0.7,
        sociability: 0.1 + rng() * 0.85,
        boldness: rng() * rng(), // skewed low: most people do not go to Level 8
        embellishment: rng() * 0.8,
      },
    };
    agents.push({
      identity,
      needs: { hunger: rng() * 0.3, thirst: rng() * 0.3, fatigue: rng() * 0.3, safety: rng() * 0.2, social: rng() * 0.4 },
      beliefs: new Map(),
      memories: [],
      trust: new Map(),
      level: 1 + Math.floor(rng() * 6),
      memCfg: MEMORY_PRESETS[cfg.memoryMode],
      tier: 0,
      // Per-agent RNG stream, so an agent replays identically in isolation.
      rng: makeRng(cfg.seed * 7919 + i * 104729),
      nextMemId: 1,
    });
  }

  const byId = new Map(agents.map((a) => [a.identity.id, a]));
  const graph = buildGraph(agents, rng, cfg.shuffleGraph);

  // Trust seeded by faction homophily plus noise. This is the structure the
  // null model destroys.
  for (const a of agents) {
    for (const other of graph.get(a.identity.id) ?? []) {
      const b = byId.get(other)!;
      const same = a.identity.faction === b.identity.faction;
      a.trust.set(other, clamp01((same ? 0.55 : 0.2) + rng() * 0.3) * 2 - 0.35);
    }
  }

  return { cfg, rng, tick: 0, agents, byId, props: defaultPropositions(), graph, work: { agentUpdates: 0, conversations: 0 } };
}

/**
 * Social graph. Agents preferentially connect within their faction, which is
 * what produces echo chambers — and is exactly the structure the `shuffleGraph`
 * null model removes while holding degree constant.
 */
function buildGraph(agents: Agent[], rng: Rng, shuffle: boolean): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (const a of agents) g.set(a.identity.id, []);

  const link = (x: string, y: string) => {
    if (x === y) return;
    const gx = g.get(x)!;
    if (!gx.includes(y)) gx.push(y);
    const gy = g.get(y)!;
    if (!gy.includes(x)) gy.push(x);
  };

  for (const a of agents) {
    const degree = 3 + Math.floor(rng() * 6);
    for (let k = 0; k < degree; k++) {
      const sameFaction = rng() < 0.72;
      const pool = sameFaction
        ? agents.filter((b) => b.identity.faction === a.identity.faction)
        : agents;
      if (pool.length > 1) link(a.identity.id, pick(rng, pool).identity.id);
    }
  }

  if (!shuffle) return g;

  // Degree-preserving rewire: same number of edges per node, structure gone.
  const stubs: string[] = [];
  for (const [id, nbrs] of g) for (let i = 0; i < nbrs.length; i++) stubs.push(id);
  for (let i = stubs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [stubs[i], stubs[j]] = [stubs[j], stubs[i]];
  }
  const shuffled = new Map<string, string[]>();
  for (const a of agents) shuffled.set(a.identity.id, []);
  for (let i = 0; i + 1 < stubs.length; i += 2) {
    const x = stubs[i];
    const y = stubs[i + 1];
    if (x === y) continue;
    if (!shuffled.get(x)!.includes(y)) shuffled.get(x)!.push(y);
    if (!shuffled.get(y)!.includes(x)) shuffled.get(y)!.push(x);
  }
  return shuffled;
}

// ---------------------------------------------------------------------------
// LOD
// ---------------------------------------------------------------------------

/**
 * Fidelity tiers.
 *
 *  0 full        — every tick, every subsystem. What a nearby agent gets.
 *  1 medium      — every 4th tick, conversations still simulated individually.
 *  2 abstract    — every 16th tick, one conversation instead of several.
 *  3 statistical — every 64th tick, beliefs nudged toward the local average
 *                  rather than simulating who said what to whom.
 *
 * Tier assignment here is a stand-in for "distance from a player"; in the game
 * it comes from the same interest-management machinery as network AoI.
 */
const TIER_PERIOD = [1, 4, 16, 64] as const;

function assignTiers(sim: Sim): void {
  if (sim.cfg.lod === "full") {
    for (const a of sim.agents) a.tier = 0;
    return;
  }
  // Deterministic, stable assignment: a fixed slice is near a player.
  sim.agents.forEach((a, i) => {
    const f = i / sim.agents.length;
    a.tier = f < 0.1 ? 0 : f < 0.3 ? 1 : f < 0.6 ? 2 : 3;
  });
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function step(sim: Sim): void {
  sim.tick++;
  assignTiers(sim);

  for (const a of sim.agents) {
    const period = TIER_PERIOD[a.tier];
    // Stagger by id hash so tiers do not update in lockstep bursts.
    if ((sim.tick + a.identity.id.length * 13) % period !== 0) continue;

    sim.work.agentUpdates++;

    decayNeeds(a.needs);
    // Decay by ticks ELAPSED since this agent last ran, which is its tier
    // period — not by the belief's total age. See the note on decayBelief.
    for (const [, b] of a.beliefs) decayBelief(b, period, sim.cfg.beliefHalfLife);

    if (a.tier === 3) {
      statisticalUpdate(sim, a);
      continue;
    }

    // Bold agents occasionally go and find out for themselves. This is the
    // only channel by which truth enters the population.
    if (a.rng() < sim.cfg.investigateRate * (0.2 + a.identity.personality.boldness)) {
      const p = pick(a.rng, sim.props);
      updateFromObservation(a, p.id, p.truth, sim.tick);
      remember(a, {
        tick: sim.tick,
        kind: "witnessed",
        about: p.id,
        participants: [],
        where: `level${a.level}`,
        importance: p.salience,
        valence: p.truth ? -0.3 : 0.1,
        confidence: 0.95,
      });
      // THIS is what makes memory causally load-bearing rather than decorative.
      reconcileTestimony(sim, a, p.id, p.truth);
    }

    const budget = a.tier === 2 ? 1 : Math.max(1, Math.round(sim.cfg.chattiness * (0.3 + a.identity.personality.sociability)));
    for (let c = 0; c < budget; c++) converse(sim, a);
  }
}

/**
 * Having seen something with your own eyes, go back through what you were
 * TOLD about it and adjust your trust in whoever told you.
 *
 * This is the mechanism that gives episodic memory a job. An agent with no
 * memory cannot do this at all — it has no record of who said what — so it
 * keeps trusting confident liars indefinitely. An agent with short-term memory
 * can only catch someone who lied to it recently. An agent with episodic
 * memory can catch a lie told weeks ago, because importance-weighted retention
 * kept the memory alive.
 *
 * The first version of this simulation stored memories and never read them,
 * and the ablation correctly reported that memory changed nothing. It is worth
 * keeping that in mind as the general lesson: a subsystem that no decision
 * consumes is not a subsystem, and an ablation over it measures noise.
 */
function reconcileTestimony(sim: Sim, a: Agent, propId: string, truth: boolean): void {
  const recalled = recall(a, sim.tick, { about: propId }, 8);
  for (const m of recalled) {
    if (m.kind !== "told" || m.participants.length === 0) continue;
    const teller = m.participants[0];

    // Confidence in the memory itself decays, so an old recollection carries
    // less weight than a fresh one — you are less sure they really said it.
    const vividness = m.confidence * Math.pow(0.5, (sim.tick - m.tick) / a.memCfg.halfLife);
    if (vividness < 0.05) continue;

    const theyClaimedTrue = m.valence < 0; // "told" memories encode the claim in valence
    const wasRight = theyClaimedTrue === truth;
    const delta = (wasRight ? 0.10 : -0.22) * vividness;

    a.trust.set(teller, Math.max(-1, Math.min(1, trustIn(a, teller) + delta)));

    if (!wasRight) {
      remember(a, {
        tick: sim.tick,
        kind: "harmed",
        about: propId,
        participants: [teller],
        where: `level${a.level}`,
        importance: 0.8,
        valence: -0.7,
        confidence: 0.9,
      });
    }
  }
}

/** One agent tells a neighbour something. */
function converse(sim: Sim, speaker: Agent): void {
  const nbrs = sim.graph.get(speaker.identity.id);
  if (!nbrs || nbrs.length === 0) return;

  const listener = sim.byId.get(pick(speaker.rng, nbrs));
  if (!listener) return;

  // Talk about what you care about most and are surest of.
  let best: Proposition | null = null;
  let bestScore = -1;
  for (const p of sim.props) {
    const b = speaker.beliefs.get(p.id);
    if (!b) continue;
    const s = b.confidence * p.salience;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  if (!best) return;

  const claim = testify(speaker, best.id, sim.tick);
  if (!claim) return;

  sim.work.conversations++;
  updateFromTestimony(listener, best.id, claim.claim, claim.confidence, speaker.identity.id, sim.tick);

  remember(listener, {
    tick: sim.tick,
    kind: "told",
    about: best.id,
    participants: [speaker.identity.id],
    where: `level${listener.level}`,
    importance: best.salience * 0.6,
    valence: claim.claim ? -0.2 : 0.05,
    confidence: 0.8,
  });

  listener.needs.social = clamp01(listener.needs.social - 0.05);
}

/**
 * Tier 3: do not simulate conversations at all. Pull the agent's beliefs
 * gently toward the mean of its neighbourhood. Cheap, and the open question
 * is how much aggregate behaviour this distorts.
 */
function statisticalUpdate(sim: Sim, a: Agent): void {
  const nbrs = sim.graph.get(a.identity.id) ?? [];
  if (nbrs.length === 0) return;
  for (const p of sim.props) {
    let sum = 0;
    let n = 0;
    for (const id of nbrs) {
      const b = sim.byId.get(id)?.beliefs.get(p.id);
      if (b) {
        sum += b.credence;
        n++;
      }
    }
    if (n === 0) continue;
    const mean = sum / n;
    const b = believe(a, p.id, sim.tick);
    b.credence = clamp01(b.credence + (mean - b.credence) * 0.25);
    b.confidence = clamp01(b.confidence + 0.02 * (1 - b.confidence));
    b.lastUpdated = sim.tick;
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface Metrics {
  tick: number;
  /** Mean |credence - truth| across agents x propositions. 0 = perfect. */
  beliefError: number;
  /** Fraction who are both wrong and sure: credence on the wrong side of 0.5
   *  with confidence > 0.5. The interesting pathology. */
  confidentlyWrong: number;
  /** Fraction holding any opinion at all (confidence > 0.08). */
  informed: number;
  /** Between-faction variance in mean credence. High = echo chambers. */
  factionPolarisation: number;
  /** Cumulative simulation work, for the cost side of the LOD curve. */
  agentUpdates: number;
  conversations: number;
}

export function measure(sim: Sim): Metrics {
  let err = 0;
  let n = 0;
  let wrongSure = 0;
  let informed = 0;
  let opinions = 0;

  const byFaction = new Map<string, { sum: number; n: number }>();

  for (const a of sim.agents) {
    let hasOpinion = false;
    for (const p of sim.props) {
      const b = a.beliefs.get(p.id);
      const credence = b?.credence ?? 0.5;
      const truth = p.truth ? 1 : 0;
      err += Math.abs(credence - truth);
      n++;
      if (b && b.confidence > 0.08) {
        hasOpinion = true;
        opinions++;
        const wrong = (credence >= 0.5) !== p.truth;
        if (wrong && b.confidence > 0.5) wrongSure++;
      }
      if (p.id === "l8_creature") {
        const f = byFaction.get(a.identity.faction) ?? { sum: 0, n: 0 };
        f.sum += credence;
        f.n++;
        byFaction.set(a.identity.faction, f);
      }
    }
    if (hasOpinion) informed++;
  }

  const means = [...byFaction.values()].filter((f) => f.n > 0).map((f) => f.sum / f.n);
  const gm = means.reduce((s, x) => s + x, 0) / Math.max(means.length, 1);
  const polar = means.reduce((s, x) => s + (x - gm) ** 2, 0) / Math.max(means.length, 1);

  return {
    tick: sim.tick,
    beliefError: err / Math.max(n, 1),
    confidentlyWrong: wrongSure / Math.max(opinions, 1),
    informed: informed / sim.agents.length,
    factionPolarisation: polar,
    agentUpdates: sim.work.agentUpdates,
    conversations: sim.work.conversations,
  };
}
