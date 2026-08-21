/**
 * THE CAUSAL AUDIT.
 *
 * A machine-checkable answer to the only question that matters about this
 * agent model:
 *
 *   Does each subsystem actually affect behaviour, or does it merely exist?
 *
 * This codebase has produced the same bug FIVE times, in five different
 * subsystems, and every instance looked like working software:
 *
 *   1. needs that only ever rose and were never satisfied
 *   2. memories stored and never read
 *   3. belief decay compounding quadratically into universal ignorance
 *   4. an event log that silently evicted the trace it was recording
 *   5. gossip gated behind a goal, so a thirsty agent said nothing
 *
 * Each produced plausible output that meant nothing. None was caught by
 * typechecking, and several survived an ablation study — because an ablation
 * over an inert subsystem measures noise and returns a confident null.
 *
 * So the audit does not ask whether a subsystem RAN. It asks whether its
 * output was CONSUMED, by walking the causal DAG forward from each production
 * to see if anything downstream descended from it. A stage with a high
 * production count and a zero consumption count is dead weight wearing the
 * costume of cognition.
 *
 * The funnel is deliberately reported as raw counts and ratios rather than a
 * pass/fail, because the healthy ratio differs per stage and is itself
 * something to be learned. What is never healthy is a zero.
 */

import type { EventLog, SimEvent, SimEventKind } from "./events.js";

/**
 * How consumption is demonstrated for a stage.
 *
 *  causal    — the consumer is a causal DESCENDANT of the production. Correct
 *              for reflex-like chains: this perception caused this belief
 *              update, which caused this goal change.
 *
 *  deferred  — the consumer merely happens LATER, to the same agent (and where
 *              given, about the same subject). Correct for storage: a memory
 *              written at tick 100 and recalled at tick 3000 is not a
 *              descendant of anything, because that gap is what memory IS.
 *              Demanding a causal link there asks memory to behave like a
 *              reflex, and reports every memory system ever built as dead.
 *
 * Getting this distinction wrong was the audit's own first bug: it flagged
 * memory, trust and goals as DEAD when all three were working, just not
 * instantaneously.
 */
export type MatchMode = "causal" | "deferred";

export interface Stage {
  name: string;
  /** Events that PRODUCE this subsystem's output. */
  produces: SimEventKind[];
  /** Events that, if they follow a production, prove consumption. */
  consumedBy: SimEventKind[];
  match: MatchMode;
  /** For deferred matching, also require the same subject, not just the agent. */
  subjectMustMatch?: boolean;
  /** Plain-English statement of what a zero here would mean. */
  deadMeans: string;
}

/**
 * The chain, stage by stage. Each stage's consumers are the next link.
 *
 * WORLD -> PERCEPTION -> BELIEF -> MEMORY -> GOAL -> ACTION -> WORLD
 */
export const STAGES: Stage[] = [
  {
    name: "perception",
    produces: ["observation", "information_received"],
    consumedBy: ["belief_updated"],
    match: "causal",
    deadMeans: "agents perceive things that never reach their beliefs",
  },
  {
    name: "belief",
    produces: ["belief_updated"],
    consumedBy: ["goal_changed", "rumour_transmitted"],
    match: "deferred",
    subjectMustMatch: true,
    deadMeans: "beliefs change nothing - the exact bug goals.ts was written to fix",
  },
  {
    name: "memory",
    produces: ["memory_created"],
    consumedBy: ["memory_recalled"],
    match: "deferred",
    subjectMustMatch: true,
    deadMeans: "memories are stored and never retrieved",
  },
  {
    name: "recall",
    produces: ["memory_recalled"],
    consumedBy: ["trust_changed"],
    match: "causal",
    deadMeans: "memories are retrieved but change no relationship or decision",
  },
  {
    name: "trust",
    produces: ["trust_changed"],
    consumedBy: ["belief_updated"],
    match: "deferred",
    deadMeans: "the social graph moves but nobody acts differently because of it",
  },
  {
    name: "goal",
    produces: ["goal_changed"],
    consumedBy: ["action_completed", "rumour_transmitted"],
    match: "deferred",
    deadMeans: "agents decide on goals they never pursue",
  },
  {
    name: "action",
    produces: ["action_completed", "rumour_transmitted"],
    consumedBy: ["belief_updated", "world_changed", "observation"],
    match: "causal",
    deadMeans: "actions happen but leave no trace in the world or in anyone",
  },
];

export interface StageResult {
  name: string;
  produced: number;
  /** Productions with at least one causally descended consumer. */
  consumed: number;
  ratio: number;
  dead: boolean;
  deadMeans: string;
}

export interface AuditReport {
  stages: StageResult[];
  orphanRate: number;
  totalEvents: number;
  /** True if any stage produced output that nothing consumed. */
  anyDead: boolean;
}

/**
 * Walk the DAG forward once, building a child index, then for each production
 * ask whether any descendant is a consumer of that stage.
 *
 * Depth-limited: a belief change that causes a goal change ten thousand ticks
 * later is not meaningfully "consumed by" it, and unbounded descent would make
 * every stage look alive as soon as one long chain existed.
 */
export function audit(log: EventLog, maxDepth = 4): AuditReport {
  const events = log.all();
  const byId = new Map<number, SimEvent>();
  const children = new Map<number, number[]>();

  for (const e of events) {
    byId.set(e.id, e);
    if (e.cause !== null) {
      const arr = children.get(e.cause);
      if (arr) arr.push(e.id);
      else children.set(e.cause, [e.id]);
    }
  }

  const hasConsumer = (rootId: number, kinds: Set<SimEventKind>): boolean => {
    let frontier = children.get(rootId) ?? [];
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next: number[] = [];
      for (const id of frontier) {
        const ev = byId.get(id);
        if (!ev) continue;
        if (kinds.has(ev.t)) return true;
        const kids = children.get(id);
        if (kids) next.push(...kids);
      }
      frontier = next;
    }
    return false;
  };

  // For deferred matching: index every consumer event by agent (and subject),
  // recording the EARLIEST index at which it occurs. A production is consumed
  // if a matching consumer exists strictly later in the stream.
  const agentOf = (e: SimEvent): string | null =>
    "agent" in e ? e.agent : e.t === "rumour_transmitted" ? e.from : null;
  const subjectOf = (e: SimEvent): string | null =>
    "prop" in e ? e.prop : "about" in e ? e.about : null;

  const laterIndex = new Map<string, number[]>();
  events.forEach((e, i) => {
    const a = agentOf(e);
    if (a === null) return;
    for (const key of [`${e.t}|${a}`, `${e.t}|${a}|${subjectOf(e)}`]) {
      const arr = laterIndex.get(key);
      if (arr) arr.push(i);
      else laterIndex.set(key, [i]);
    }
  });

  const hasLater = (stage: Stage, e: SimEvent, i: number): boolean => {
    const a = agentOf(e);
    if (a === null) return false;
    for (const kind of stage.consumedBy) {
      const key = stage.subjectMustMatch
        ? `${kind}|${a}|${subjectOf(e)}`
        : `${kind}|${a}`;
      const idxs = laterIndex.get(key);
      if (!idxs) continue;
      // Any occurrence strictly after this production counts.
      if (idxs[idxs.length - 1] > i) return true;
    }
    return false;
  };

  const stages: StageResult[] = [];
  for (const stage of STAGES) {
    const producers = new Set(stage.produces);
    const consumers = new Set(stage.consumedBy);
    let produced = 0;
    let consumed = 0;
    events.forEach((e, i) => {
      if (!producers.has(e.t)) return;
      produced++;
      const ok =
        stage.match === "causal" ? hasConsumer(e.id, consumers) : hasLater(stage, e, i);
      if (ok) consumed++;
    });
    stages.push({
      name: stage.name,
      produced,
      consumed,
      ratio: produced === 0 ? 0 : consumed / produced,
      // Produced output that nothing ever consumed is the failure. Producing
      // nothing at all is a different problem and is reported separately.
      dead: produced > 0 && consumed === 0,
      deadMeans: stage.deadMeans,
    });
  }

  // Events with no causal parent that are not root causes. A high orphan rate
  // means the `caused()` scoping is not wrapping enough of the code, and the
  // audit is measuring less than it appears to.
  const rootKinds = new Set<SimEventKind>(["observation", "information_received", "world_changed"]);
  let orphans = 0;
  for (const e of events) if (e.cause === null && !rootKinds.has(e.t)) orphans++;

  return {
    stages,
    orphanRate: events.length === 0 ? 0 : orphans / events.length,
    totalEvents: events.length,
    anyDead: stages.some((s) => s.dead),
  };
}

/** Human-readable funnel. */
export function formatAudit(r: AuditReport): string {
  const lines: string[] = [];
  lines.push(`  ${"stage".padEnd(12)}${"produced".padStart(10)}${"consumed".padStart(10)}${"ratio".padStart(8)}   status`);
  for (const s of r.stages) {
    const status = s.produced === 0 ? "never ran" : s.dead ? "DEAD" : s.ratio < 0.02 ? "near-dead" : "ok";
    lines.push(
      `  ${s.name.padEnd(12)}${String(s.produced).padStart(10)}${String(s.consumed).padStart(10)}` +
        `${(s.ratio * 100).toFixed(1).padStart(7)}%   ${status}`
    );
    if (s.dead) lines.push(`  ${"".padEnd(12)}^^ ${s.deadMeans}`);
  }
  lines.push("");
  lines.push(`  events: ${r.totalEvents}   orphan rate: ${(r.orphanRate * 100).toFixed(1)}%`);
  return lines.join("\n");
}
