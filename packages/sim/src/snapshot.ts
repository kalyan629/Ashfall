/**
 * Serialising Marrow.
 *
 * Turns a live `Sim` into plain JSON and back. Three things here are easy to
 * get wrong and each one silently breaks the persistence guarantee:
 *
 * 1. MAPS DO NOT SURVIVE JSON.stringify. `beliefs`, `trust` and
 *    `lastBeliefEvent` all serialise to `{}` without complaint. A world
 *    restored that way loads sixty survivors who have never met anyone and
 *    believe nothing — and it looks like a *working* fresh start rather than
 *    a failed restore, which is the worst kind of bug.
 *
 * 2. THE RNG IS A CLOSURE. Restoring beliefs but reseeding generators makes
 *    every survivor re-run the exact random sequence they already lived. The
 *    generator's internal word is persisted and reinstalled.
 *
 * 3. WORLD TIME IS NOT TICK COUNT. A tick is a scheduling artefact; world time
 *    is what routines, shifts and rumour freshness are actually about. They
 *    must be stored separately or an offline gap is indistinguishable from a
 *    lag spike.
 */

import { makeRng } from "./core.js";
import type { Belief, Memory, Proposition } from "./core.js";
import { MEMORY_PRESETS, type Agent, type Needs } from "./agent.js";
import type { Goal } from "./goals.js";
import type { Sim, SimConfig } from "./sim.js";

export interface AgentSnapshot {
  identity: Agent["identity"];
  needs: Needs;
  beliefs: [string, Belief][];
  memories: Memory[];
  trust: [string, number][];
  lastBeliefEvent: [string, number][];
  level: number;
  memoryMode: string;
  tier: number;
  goal: Goal | null;
  rngState: number;
  nextMemId: number;
}

export interface WorldSnapshot {
  cfg: SimConfig;
  tick: number;
  /** Seconds of in-world time. Advances with ticks, and can be fast-forwarded
   *  across a server outage without simulating every intervening tick. */
  worldTime: number;
  props: Proposition[];
  agents: AgentSnapshot[];
  graph: [string, string[]][];
  work: Sim["work"];
}

export function serializeSim(sim: Sim): WorldSnapshot {
  return {
    cfg: sim.cfg,
    tick: sim.tick,
    worldTime: sim.worldTime,
    // Propositions carry the WORLD'S truth, which agents never see. If this is
    // not persisted, a restored world silently resets whether the scrubber is
    // actually broken while everyone's beliefs about it survive.
    props: sim.props.map((p) => ({ ...p })),
    agents: sim.agents.map((a) => ({
      identity: a.identity,
      needs: { ...a.needs },
      beliefs: [...a.beliefs.entries()],
      memories: a.memories,
      trust: [...a.trust.entries()],
      lastBeliefEvent: [...a.lastBeliefEvent.entries()],
      level: a.level,
      memoryMode: a.memCfg.mode,
      tier: a.tier,
      goal: a.goal,
      rngState: a.rng.state(),
      nextMemId: a.nextMemId,
    })),
    graph: [...sim.graph.entries()],
    work: { ...sim.work },
  };
}

/**
 * Rebuild a Sim from a snapshot.
 *
 * Takes a freshly constructed sim (for its log and any wiring) and overwrites
 * its state, rather than constructing agents from scratch here — that keeps
 * construction logic in exactly one place.
 */
export function restoreSim(sim: Sim, snap: WorldSnapshot): void {
  sim.tick = snap.tick;
  sim.worldTime = snap.worldTime;
  sim.props = snap.props.map((p) => ({ ...p }));

  sim.agents = snap.agents.map((s) => {
    // mulberry32's entire state is one 32-bit word, and makeRng sets that word
    // directly from its argument — so seeding with the SAVED state resumes the
    // sequence exactly where it stopped. No reseeding machinery needed.
    const rng = makeRng(s.rngState);
    const agent: Agent = {
      identity: s.identity,
      needs: s.needs,
      beliefs: new Map(s.beliefs),
      memories: s.memories,
      trust: new Map(s.trust),
      lastBeliefEvent: new Map(s.lastBeliefEvent),
      level: s.level,
      memCfg: MEMORY_PRESETS[s.memoryMode as keyof typeof MEMORY_PRESETS] ?? MEMORY_PRESETS.episodic,
      tier: s.tier as Agent["tier"],
      goal: s.goal,
      rng,
      nextMemId: s.nextMemId,
    };
    return agent;
  });

  sim.byId = new Map(sim.agents.map((a) => [a.identity.id, a]));
  sim.graph = new Map(snap.graph);
  sim.work = snap.work;
}

