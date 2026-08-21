/**
 * The canonical event stream.
 *
 * Every causally significant transition in a survivor's cognition is emitted
 * here. One mechanism, five payoffs:
 *
 *   debugging    — why is survivor-41 walking to the Works?
 *   replay       — rebuild any agent's state from (seed, events)
 *   experiments  — metrics are folds over the stream, not bespoke counters
 *   explainability — a readable causal trace, which is the actual demo
 *   thesis data  — events.jsonl is the dataset
 *
 * THE DESIGN RULE THIS ENFORCES, which is the north star for the whole agent
 * model: an agent is autonomous only when its internal state can causally
 * alter its future behaviour, and its experiences can causally alter its
 * internal state. Every event below names a link in that chain. If a subsystem
 * cannot emit one, it is not participating in cognition and should not exist.
 *
 * `cause` on each event is the id of the event that produced it, so the stream
 * is a DAG, not a log. That is what makes "why did this happen" answerable by
 * walking backwards rather than by guessing.
 */

export type SimEvent =
  | { t: "observation"; id: number; tick: number; agent: string; prop: string; observed: boolean; surprise: number; cause: number | null }
  | { t: "information_received"; id: number; tick: number; agent: string; prop: string; claim: boolean; from: string; credibility: number; cause: number | null }
  | { t: "belief_updated"; id: number; tick: number; agent: string; prop: string; from: number; to: number; confidence: number; cause: number | null }
  | { t: "memory_created"; id: number; tick: number; agent: string; memory: number; kind: string; about: string; importance: number; cause: number | null }
  | { t: "trust_changed"; id: number; tick: number; agent: string; other: string; from: number; to: number; reason: string; cause: number | null }
  | { t: "goal_changed"; id: number; tick: number; agent: string; from: string; to: string; utility: number; reason: string; cause: number | null }
  | { t: "rumour_transmitted"; id: number; tick: number; from: string; to: string; prop: string; claim: boolean; confidence: number; hops: number; cause: number | null }
  | { t: "action_completed"; id: number; tick: number; agent: string; action: string; cause: number | null }
  | { t: "need_satisfied"; id: number; tick: number; agent: string; need: string; cause: number | null }
  | { t: "world_changed"; id: number; tick: number; prop: string; truth: boolean; by: string; cause: number | null };

export type SimEventKind = SimEvent["t"];

/**
 * An event before the log assigns it an id and a causal parent.
 *
 * Must be DISTRIBUTIVE. A plain `Omit<SimEvent, "id" | "cause">` collapses the
 * union to only the keys every member shares — which is `t` and `tick` — and
 * then rejects `agent`, `prop` and everything else as unknown properties. The
 * conditional type forces the omit to be applied to each member separately.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewEvent = DistributiveOmit<SimEvent, "id" | "cause">;

/**
 * Append-only event log with causal linking.
 *
 * Bounded by default because the game server runs this forever; experiments
 * pass Infinity because they want the whole trace.
 */
export class EventLog {
  private events: SimEvent[] = [];
  private nextId = 1;
  /** Set while an event is being handled, so children link to their parent. */
  private current: number | null = null;

  constructor(private capacity = 20000) {}

  emit(e: NewEvent): number {
    const id = this.nextId++;
    this.events.push({ ...(e as object), id, cause: this.current } as SimEvent);
    if (this.events.length > this.capacity) this.events.shift();
    return id;
  }

  /** Run `fn` with `parent` as the causal parent of anything it emits. */
  caused<T>(parent: number | null, fn: () => T): T {
    const prev = this.current;
    this.current = parent;
    try {
      return fn();
    } finally {
      this.current = prev;
    }
  }

  all(): readonly SimEvent[] {
    return this.events;
  }

  of(kind: SimEventKind): SimEvent[] {
    return this.events.filter((e) => e.t === kind);
  }

  byId(id: number): SimEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  /** Walk backwards from an event to the root cause. The "why" query. */
  chainTo(id: number): SimEvent[] {
    const out: SimEvent[] = [];
    let cur = this.byId(id);
    while (cur) {
      out.unshift(cur);
      cur = cur.cause === null ? undefined : this.byId(cur.cause);
    }
    return out;
  }

  /** Everything descended from an event — the blast radius of one rumour. */
  descendants(root: number): SimEvent[] {
    const seen = new Set<number>([root]);
    const out: SimEvent[] = [];
    for (const e of this.events) {
      if (e.cause !== null && seen.has(e.cause)) {
        seen.add(e.id);
        out.push(e);
      }
    }
    return out;
  }

  clear(): void {
    this.events = [];
    this.nextId = 1;
  }
}

/** One line of human-readable trace. Used by the causal-chain demo. */
export function describe(e: SimEvent): string {
  switch (e.t) {
    case "observation":
      return `${e.agent} SAW ${e.prop}=${e.observed} (surprise ${e.surprise.toFixed(2)})`;
    case "information_received":
      return `${e.agent} WAS TOLD ${e.prop}=${e.claim} by ${e.from} (credibility ${e.credibility.toFixed(2)})`;
    case "belief_updated":
      return `${e.agent} BELIEF ${e.prop} ${e.from.toFixed(2)} -> ${e.to.toFixed(2)} (conf ${e.confidence.toFixed(2)})`;
    case "memory_created":
      return `${e.agent} REMEMBERED ${e.kind} about ${e.about} (importance ${e.importance.toFixed(2)})`;
    case "trust_changed":
      return `${e.agent} TRUST in ${e.other} ${e.from.toFixed(2)} -> ${e.to.toFixed(2)} (${e.reason})`;
    case "goal_changed":
      return `${e.agent} GOAL ${e.from} -> ${e.to} (utility ${e.utility.toFixed(2)}, ${e.reason})`;
    case "rumour_transmitted":
      return `${e.from} TOLD ${e.to} ${e.prop}=${e.claim} (conf ${e.confidence.toFixed(2)}, hop ${e.hops})`;
    case "action_completed":
      return `${e.agent} DID ${e.action}`;
    case "need_satisfied":
      return `${e.agent} SATISFIED ${e.need}`;
    case "world_changed":
      return `WORLD ${e.prop} := ${e.truth} (by ${e.by})`;
  }
}
