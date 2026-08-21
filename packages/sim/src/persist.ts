/**
 * Durable world state.
 *
 * Marrow must survive `Ctrl-C`. Sixty survivors with beliefs, memories and
 * grudges that evaporate on restart are not a persistent world, they are a
 * screensaver.
 *
 * SHAPE
 * -----
 *   snapshot  +  durable events since the snapshot  =  reconstructed world
 *
 * THE FIREHOSE PROBLEM, AND WHY THIS IS NOT PURE EVENT SOURCING
 * ------------------------------------------------------------
 * A measured 3300-tick run emits 568,216 events — about 172 per tick, mostly
 * belief nudges from routine conversation. Persisting all of that is not event
 * sourcing, it is a denial-of-service attack on your own disk, and replaying it
 * to reach current state would take longer than the original run.
 *
 * So events are CLASSIFIED. Cognitive churn is reconstructed from snapshots;
 * only events that are *historically meaningful* are appended durably. The
 * test for durability is not "did state change" but "would someone later ask
 * why this happened".
 *
 * WHAT MAKES THIS CRASH-SAFE RATHER THAN JUST A FILE
 * --------------------------------------------------
 *   - a monotonic global sequence on every record, surviving restart
 *   - snapshots written to a temp path then renamed, which is atomic on one
 *     filesystem, so a crash mid-write leaves the previous snapshot intact
 *   - a truncated final line (crash during append) is DETECTED and dropped
 *     rather than aborting the whole restore
 *   - a schema version on every record, so a future format change is a
 *     migration rather than a corrupt file
 *   - append is batched and flushed, because fsync per event at 20 Hz would
 *     dominate the tick budget
 *
 * The rest of Ashfall must not know any of this is JSONL.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { SimEvent, SimEventKind } from "./events.js";

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Durability classification
// ---------------------------------------------------------------------------

/**
 * How much a class of event is worth keeping forever.
 *
 *  ephemeral  — never written. Movement, per-tick belief nudges. Reconstructed
 *               from the next snapshot; nobody will ever ask about them.
 *  state      — captured by snapshots only.
 *  durable    — appended to the log. The history of the shelter.
 */
export type Durability = "ephemeral" | "state" | "durable";

export const DURABILITY: Record<SimEventKind, Durability> = {
  // Routine cognition. 172 events per tick live here; none of it is history.
  belief_updated: "ephemeral",
  memory_created: "ephemeral",
  memory_recalled: "ephemeral",
  rumour_transmitted: "ephemeral",
  need_satisfied: "ephemeral",

  // Meaningful but recoverable from a snapshot.
  goal_changed: "state",
  observation: "state",

  // The history of Marrow. Someone will ask why these happened.
  information_received: "durable", // a player told somebody something
  trust_changed: "durable", // but see isDurable — only significant ones
  action_completed: "durable", // somebody did something to the world
  world_changed: "durable", // the world itself moved
};

/**
 * Whether THIS event instance is worth keeping, not just its type.
 *
 * Type alone is too blunt. Trust is adjusted every time a recalled testimony
 * is reconciled — up to eight nudges per recall — and treating every one as
 * history produced 998 KB per five minutes of world time, roughly 12 MB an
 * hour, for a forty-person shelter. That is the firehose: technically
 * event-sourced, practically unusable.
 *
 * The distinction that matters: a micro-adjustment is STATE and belongs in the
 * next snapshot; a relationship crossing zero is HISTORY. Somebody deciding
 * they no longer trust you is a thing you would ask about later. Somebody
 * trusting you 0.004 less is not.
 */
export function isDurable(e: SimEvent): boolean {
  if (DURABILITY[e.t] !== "durable") return false;

  if (e.t === "trust_changed") {
    const crossedZero = e.from >= 0 !== e.to >= 0;
    const large = Math.abs(e.to - e.from) >= 0.15;
    return crossedZero || large;
  }

  return true;
}

// ---------------------------------------------------------------------------
// The interface — JSONL is only implementation #1
// ---------------------------------------------------------------------------

export interface StoredEvent {
  seq: number;
  v: number;
  event: SimEvent;
}

export interface EventStore<S> {
  /** Append durable events. Resolves once they are handed to the OS. */
  append(events: SimEvent[]): Promise<void>;
  /** Replay durable events with sequence > `fromSequence`. */
  read(fromSequence: number): AsyncIterable<StoredEvent>;
  /** Write a full state snapshot atomically. */
  snapshot(state: S): Promise<void>;
  /** Load the most recent snapshot, or null on a fresh world. */
  restore(): Promise<{ state: S; sequence: number } | null>;
  /** Flush anything buffered. Call before exit. */
  flush(): Promise<void>;
}

// ---------------------------------------------------------------------------
// JSONL implementation
// ---------------------------------------------------------------------------

export class JsonlEventStore<S> implements EventStore<S> {
  private seq = 0;
  private buffer: string[] = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private dir: string,
    /** Append records buffered before hitting the disk. */
    private batchSize = 64
  ) {}

  private get logPath() {
    return path.join(this.dir, "events.jsonl");
  }
  private get snapPath() {
    return path.join(this.dir, "snapshot.json");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async append(events: SimEvent[]): Promise<void> {
    for (const e of events) {
      if (!isDurable(e)) continue;
      const rec: StoredEvent = { seq: ++this.seq, v: SCHEMA_VERSION, event: e };
      this.buffer.push(JSON.stringify(rec));
    }
    if (this.buffer.length >= this.batchSize) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return await this.writing;
    const chunk = this.buffer.join("\n") + "\n";
    this.buffer = [];
    // Serialise writes so two flushes cannot interleave partial lines.
    this.writing = this.writing.then(() => fs.appendFile(this.logPath, chunk, "utf8"));
    return this.writing;
  }

  async *read(fromSequence: number): AsyncIterable<StoredEvent> {
    let raw: string;
    try {
      raw = await fs.readFile(this.logPath, "utf8");
    } catch {
      return; // no log yet is not an error
    }

    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;

      let rec: StoredEvent;
      try {
        rec = JSON.parse(line) as StoredEvent;
      } catch {
        // A parse failure on the LAST line is a crash during append: the
        // process died mid-write and left a partial record. That is expected
        // and recoverable — drop it. A parse failure anywhere else is real
        // corruption and must be loud, because silently skipping it would
        // hand back a world with a hole in its history.
        const isLast = lines.slice(i + 1).every((l) => l.trim() === "");
        if (isLast) {
          console.warn(`[persist] dropping truncated final record (line ${i + 1})`);
          break;
        }
        throw new Error(`[persist] corrupt record at line ${i + 1}, not at end of file`);
      }

      if (rec.v !== SCHEMA_VERSION) {
        throw new Error(
          `[persist] record v${rec.v} but this build speaks v${SCHEMA_VERSION}; migration required`
        );
      }
      if (rec.seq > this.seq) this.seq = rec.seq;
      if (rec.seq > fromSequence) yield rec;
    }
  }

  async snapshot(state: S): Promise<void> {
    await this.flush();
    const payload = JSON.stringify({ v: SCHEMA_VERSION, sequence: this.seq, state });
    const tmp = this.snapPath + ".tmp";
    // Write-then-rename. rename() is atomic within a filesystem, so a crash
    // during this leaves the PREVIOUS snapshot intact rather than a half-
    // written file that restores into a corrupt world.
    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, this.snapPath);
  }

  async restore(): Promise<{ state: S; sequence: number } | null> {
    try {
      const raw = await fs.readFile(this.snapPath, "utf8");
      const parsed = JSON.parse(raw) as { v: number; sequence: number; state: S };
      if (parsed.v !== SCHEMA_VERSION) {
        throw new Error(`[persist] snapshot v${parsed.v}, build speaks v${SCHEMA_VERSION}`);
      }
      this.seq = parsed.sequence;
      return { state: parsed.state, sequence: parsed.sequence };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}
