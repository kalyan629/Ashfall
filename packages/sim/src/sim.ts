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
import { EventLog } from "./events.js";
import { selectGoal, shouldSwitch, type Goal } from "./goals.js";
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
  /** Event log size. Experiments want the whole trace; the server does not. */
  logCapacity: number;
}

/** In-world seconds per simulation tick. At 5 Hz cognition this makes one
 *  real minute roughly one in-world hour, so a shift pattern is observable in
 *  a play session rather than taking a real day. */
export const WORLD_SECONDS_PER_TICK = 12;

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
  logCapacity: 20000,
};

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface Sim {
  cfg: SimConfig;
  rng: Rng;
  tick: number;
  /**
   * Seconds of IN-WORLD time, distinct from tick count.
   *
   * A tick is a scheduling artefact of whatever host is running the sim; world
   * time is what shifts, sleep, patrol rotations and rumour freshness are
   * actually about. Keeping them separate is what makes an offline gap
   * expressible: after a restart, worldTime can be fast-forwarded across hours
   * the server was down without simulating every intervening tick.
   */
  worldTime: number;
  agents: Agent[];
  byId: Map<string, Agent>;
  props: Proposition[];
  /** Undirected adjacency: who talks to whom. */
  graph: Map<string, string[]>;
  /** Per-tick cost accounting, for the LOD cost/accuracy curve. */
  work: { agentUpdates: number; conversations: number };
  /** Canonical causal event stream. Metrics are folds over this. */
  log: EventLog;
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
    // Actionable by scrubbers, and the subject of the player-to-population
    // information chain. Starts TRUE and nobody knows it.
    { id: "scrubber_broken", truth: true, salience: 0.9, label: "The east scrubber is failing" },
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
      goal: null,
      lastBeliefEvent: new Map(),
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

  return {
    cfg,
    rng,
    tick: 0,
    worldTime: 0,
    agents,
    byId,
    props: defaultPropositions(),
    graph,
    work: { agentUpdates: 0, conversations: 0 },
    log: new EventLog(cfg.logCapacity),
  };
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
// Instrumentation helpers
// ---------------------------------------------------------------------------

/**
 * Emit a belief_updated event and remember its id against the proposition.
 *
 * Every belief change must go through here. The recorded id is what lets a
 * later goal change be emitted as that belief change's causal child, which is
 * the difference between claiming beliefs drive behaviour and being able to
 * demonstrate it.
 */
function logBelief(sim: Sim, a: Agent, prop: string, before: number): void {
  const b = a.beliefs.get(prop);
  if (!b) return;
  const id = sim.log.emit({
    t: "belief_updated",
    tick: sim.tick,
    agent: a.identity.id,
    prop,
    from: before,
    to: b.credence,
    confidence: b.confidence,
  });
  a.lastBeliefEvent.set(prop, id);
}

/** Store a memory AND record it, so the memory stage is observable at all. */
function logRemember(sim: Sim, a: Agent, m: Parameters<typeof remember>[1]): void {
  if (a.memCfg.mode === "none") return;
  remember(a, m);
  sim.log.emit({
    t: "memory_created",
    tick: sim.tick,
    agent: a.identity.id,
    memory: a.nextMemId - 1,
    kind: m.kind,
    about: m.about,
    importance: m.importance,
  });
}

/** Adjust trust and record it. Previously this moved silently. */
function logTrust(sim: Sim, a: Agent, other: string, delta: number, reason: string): void {
  const before = trustIn(a, other);
  const after = Math.max(-1, Math.min(1, before + delta));
  a.trust.set(other, after);
  sim.log.emit({
    t: "trust_changed",
    tick: sim.tick,
    agent: a.identity.id,
    other,
    from: before,
    to: after,
    reason,
  });
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
  sim.worldTime += WORLD_SECONDS_PER_TICK;
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

    // GOAL SELECTION. Beliefs, needs, personality and occupation all feed the
    // utility, so a belief acquired by testimony can change what this survivor
    // does next. That edge is the whole reason this block exists.
    const candidate = selectGoal(a, sim.props, sim.tick);
    if (!a.goal || shouldSwitch(a.goal.utility, candidate)) {
      const from = a.goal ? `${a.goal.kind}(${a.goal.prop ?? "-"})` : "none";
      const to = `${candidate.kind}(${candidate.prop ?? "-"})`;
      // Must compare SUBJECT too. warn(l8_creature) -> warn(scrubber_broken)
      // is a real change of behaviour and was previously invisible, because
      // only the kind was compared and it stayed 'warn'.
      if (from !== to) {
        // Belief-driven goals are emitted as children of the belief change
        // that produced them, so the audit can see the edge rather than
        // having to take the comment's word for it.
        const parent = candidate.prop ? (a.lastBeliefEvent.get(candidate.prop) ?? null) : null;
        sim.log.caused(parent, () => sim.log.emit({
          t: "goal_changed",
          tick: sim.tick,
          agent: a.identity.id,
          from,
          to,
          utility: candidate.utility,
          reason: candidate.reason,
        }));
      }
      a.goal = candidate;
    }

    // Bold agents occasionally go and find out for themselves. This is the
    // only channel by which truth enters the population.
    // Investigating is now something an agent DECIDES to do, and it targets
    // the specific proposition it is uncertain about rather than a random one.
    const wantsToLook = a.goal?.kind === "investigate" || a.goal?.kind === "repair";
    const lookRate = sim.cfg.investigateRate * (wantsToLook ? 14 : 0.6);
    if (a.rng() < lookRate * (0.2 + a.identity.personality.boldness)) {
      const targetId = a.goal?.prop;
      const p = (targetId && sim.props.find((x) => x.id === targetId)) || pick(a.rng, sim.props);
      // SURPRISE = prediction error. What you expected minus what you found.
      // It drives memory importance, so agents remember what violated their
      // expectations rather than dumping every event into a store. A confirmed
      // suspicion is forgettable; a shock is not.
      const prior = a.beliefs.get(p.id);
      const expected = prior?.credence ?? 0.5;
      const surprise = Math.abs((p.truth ? 1 : 0) - expected);

      const obsId = sim.log.emit({
        t: "observation",
        tick: sim.tick,
        agent: a.identity.id,
        prop: p.id,
        observed: p.truth,
        surprise,
      });

      sim.log.caused(obsId, () => {
        const before = a.beliefs.get(p.id)?.credence ?? 0.5;
        updateFromObservation(a, p.id, p.truth, sim.tick);
        logBelief(sim, a, p.id, before);
        if (a.goal?.kind === "repair" && a.goal.prop === p.id) {
          sim.log.emit({
            t: "action_completed",
            tick: sim.tick,
            agent: a.identity.id,
            action: `inspected ${p.id}`,
          });
        }
      });

      logRemember(sim, a, {
        tick: sim.tick,
        kind: "witnessed",
        about: p.id,
        participants: [],
        where: `level${a.level}`,
        // Prediction-error-weighted, not flat salience.
        importance: Math.min(1, p.salience * (0.35 + surprise)),
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
  // Emit recall itself. Without this, memory USE is invisible to the audit —
  // we could count memories created but never whether any were consulted,
  // which is precisely the blind spot that let a stored-but-never-read memory
  // system pass as working.
  if (recalled.length === 0) return;

  const recallId = sim.log.emit({
    t: "memory_recalled",
    tick: sim.tick,
    agent: a.identity.id,
    count: recalled.length,
    about: propId,
  });

  // Everything the recall causes must be emitted INSIDE this scope. Without
  // it the trust updates are siblings of the recall rather than children, and
  // the audit correctly refuses to accept that recall changed anything —
  // a causal claim you cannot trace is not a causal claim.
  sim.log.caused(recallId, () => {
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

    logTrust(sim, a, teller, delta, wasRight ? "testimony confirmed" : "testimony contradicted");

    if (!wasRight) {
      logRemember(sim, a, {
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
  });
}

/** One agent tells a neighbour something. */
function converse(sim: Sim, speaker: Agent): void {
  const nbrs = sim.graph.get(speaker.identity.id);
  if (!nbrs || nbrs.length === 0) return;

  const listener = sim.byId.get(pick(speaker.rng, nbrs));
  if (!listener) return;

  // A survivor whose goal is to WARN talks about the thing they want to warn
  // about. Otherwise they talk about whatever they are surest of. This is the
  // link that turns 'I now believe X' into 'X spreads'.
  if (speaker.goal?.kind === 'warn' && speaker.goal.prop) {
    const p = sim.props.find((x) => x.id === speaker.goal!.prop);
    if (p) {
      const claim = testify(speaker, p.id, sim.tick);
      if (claim) {
        sim.work.conversations++;
        const rid = sim.log.emit({
          t: 'rumour_transmitted', tick: sim.tick,
          from: speaker.identity.id, to: listener.identity.id,
          prop: p.id, claim: claim.claim, confidence: claim.confidence,
          hops: speaker.beliefs.get(p.id)?.corroborations ?? 0,
        });
        const before = listener.beliefs.get(p.id)?.credence ?? 0.5;
        sim.log.caused(rid, () => {
          updateFromTestimony(listener, p.id, claim.claim, claim.confidence, speaker.identity.id, sim.tick);
          logBelief(sim, listener, p.id, before);
          logRemember(sim, listener, {
            tick: sim.tick, kind: 'told', about: p.id,
            participants: [speaker.identity.id], where: 'level' + listener.level,
            importance: p.salience * 0.6, valence: claim.claim ? -0.2 : 0.05, confidence: 0.8,
          });
        });
        listener.needs.social = clamp01(listener.needs.social - 0.05);
        return;
      }
    }
  }

  /**
   * Pick a topic.
   *
   * TALKING IS NOT A DESTINATION. An earlier version gated gossip on the agent
   * having adopted a `warn` goal, which made speech compete with drinking and
   * eating — so a survivor at thirst 0.90 who had just been told the air
   * scrubber was failing said nothing at all, because fetching water scored
   * higher. People mention things *while* doing something else.
   *
   * So the goal no longer decides WHETHER you speak, only biases WHAT about.
   * The topic score is the same novelty-weighted quantity that drives the warn
   * utility: strength x salience x freshness x saturation. Fresh news beats an
   * old certainty, and something everyone has already heard stops being worth
   * repeating.
   */
  let best: Proposition | null = null;
  let bestScore = -1;
  for (const p of sim.props) {
    const b = speaker.beliefs.get(p.id);
    if (!b) continue;
    const freshness = 0.35 + 1.9 * Math.pow(0.5, (sim.tick - b.lastUpdated) / 250);
    const saturation = 1 / (1 + b.corroborations * 0.45);
    let s = b.credence * b.confidence * p.salience * freshness * saturation;
    // A survivor who has decided to warn about something leads with it.
    if (speaker.goal?.kind === "warn" && speaker.goal.prop === p.id) s *= 2.5;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  if (!best) return;

  const claim = testify(speaker, best.id, sim.tick);
  if (!claim) return;

  sim.work.conversations++;

  const rumourId = sim.log.emit({
    t: 'rumour_transmitted',
    tick: sim.tick,
    from: speaker.identity.id,
    to: listener.identity.id,
    prop: best.id,
    claim: claim.claim,
    confidence: claim.confidence,
    hops: (speaker.beliefs.get(best.id)?.corroborations ?? 0),
  });

  const beforeCred = listener.beliefs.get(best.id)?.credence ?? 0.5;
  sim.log.caused(rumourId, () => {
    updateFromTestimony(listener, best.id, claim.claim, claim.confidence, speaker.identity.id, sim.tick);
    logBelief(sim, listener, best!.id, beforeCred);
  });

  logRemember(sim, listener, {
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

// ---------------------------------------------------------------------------
// Information injection — the player's edge into the simulation
// ---------------------------------------------------------------------------

/**
 * Tell a survivor something.
 *
 * This is deliberately NOT a dialogue system. It is an information exchange
 * modelled as a first-class simulation event, which means the whole chain —
 * credibility evaluation, belief update, memory formation, onward gossip,
 * goal change, movement — can be built and TESTED with no LLM anywhere near
 * it. Natural language can sit on top of this later; it cannot substitute
 * for it.
 *
 * The player enters the trust graph like anyone else: `from` is an ordinary
 * source id, so a survivor who has caught the player lying will discount them
 * exactly as they would discount survivor-12.
 *
 * @returns the root event id, so a caller can ask the log for everything that
 *          followed from this one sentence.
 */
export function tell(
  sim: Sim,
  toId: string,
  propId: string,
  claim: boolean,
  confidence: number,
  from: string,
  /**
   * Is the speaker reporting something they SAW, or passing on hearsay?
   *
   * Load-bearing, and missing on the first run. A first-hand account is
   * epistemically stronger than a rumour, and without modelling that, one
   * telling left the listener at confidence 0.05 — below the threshold at
   * which testify() will repeat anything. The player said something true, the
   * listener believed it, and the chain died silently, because an agent who
   * believes something but is unsure of it stays quiet.
   */
  firsthand = true
): number | null {
  const a = sim.byId.get(toId);
  if (!a) return null;

  // A player who has never spoken to this survivor is not a stranger off the
  // street — they are a fellow resident of a sealed shelter. Standing is
  // modest but non-zero, and it becomes a real trust-graph entry from here on,
  // so lying will cost them exactly what it costs survivor-12.
  if (!a.trust.has(from)) a.trust.set(from, 0.2);

  const credibility = Math.abs(trustIn(a, from)) * 0.6 + 0.4;

  const rootId = sim.log.emit({
    t: "information_received",
    tick: sim.tick,
    agent: toId,
    prop: propId,
    claim,
    from,
    credibility,
  });

  sim.log.caused(rootId, () => {
    const before = a.beliefs.get(propId)?.credence ?? 0.5;
    updateFromTestimony(a, propId, claim, confidence, from, sim.tick);
    const after = a.beliefs.get(propId)!;

    // First-hand testimony carries far more confidence than hearsay. Hearsay
    // still only nudges, which is what keeps rumours weak until corroborated.
    if (firsthand) {
      after.confidence = Math.min(1, after.confidence + 0.34 * credibility * confidence);
    }

    logBelief(sim, a, propId, before);

    const prop = sim.props.find((p) => p.id === propId);
    logRemember(sim, a, {
      tick: sim.tick,
      kind: "told",
      about: propId,
      participants: [from],
      where: `level${a.level}`,
      importance: (prop?.salience ?? 0.5) * 0.75,
      valence: claim ? -0.2 : 0.05,
      confidence: 0.85,
    });
  });

  return rootId;
}

/** Change the world. Used by interventions: cut the water, break the scrubber. */
export function setWorldTruth(sim: Sim, propId: string, truth: boolean, by = "world"): void {
  const p = sim.props.find((x) => x.id === propId);
  if (!p) return;
  p.truth = truth;
  sim.log.emit({ t: "world_changed", tick: sim.tick, prop: propId, truth, by });
}
