/**
 * THE INFORMATION LAYER.
 *
 * Three things that are constantly conflated, and must never be:
 *
 *   WORLD TRUTH   "The scrubber is broken."
 *   CLAIM         "Survivor-12 says the scrubber is broken."
 *   BELIEF        "Survivor-58 holds it at 0.73 credence."
 *
 * World -> observation -> CLAIM -> transmission -> CLAIM -> interpretation ->
 * BELIEF. Collapsing any two of those loses the thing that makes this a
 * simulation rather than a quest flag.
 *
 * AN InformationClaim IS AN IMMUTABLE FACT ABOUT A TRANSFER. It does not
 * mutate anybody. It records that at some world-time, some source asserted
 * something to some audience over some channel. What happens next is entirely
 * the RECEIVER'S business:
 *
 *   claim -> evaluate(source, trust, context) -> belief -> memory -> goal ->
 *            possibly a new claim
 *
 * That separation buys something specific: the SAME claim produces DIFFERENT
 * beliefs in different agents, without the claim itself changing. A trusted
 * source and a known liar can utter identical words and move two listeners in
 * opposite directions. If claims mutated beliefs directly, that would be
 * impossible to express.
 *
 * PROVENANCE IS IMMUTABLE. Every claim remembers its parent, so "why does
 * survivor-58 believe this?" is a walk up the chain to whoever first saw
 * something with their own eyes — or to the player who made it up.
 */

import type { Sim } from "./sim.js";
import { believe, remember, trustIn, updateFromTestimony, type Agent } from "./agent.js";
import type { Proposition } from "./core.js";

/**
 * How a claim travelled. The channel is not decoration — it changes how the
 * claim is weighed, and it is what lets the same machinery serve a whispered
 * rumour, a posted notice and an official broadcast.
 */
export type Channel =
  /** One person to one person, in the room. Carries trust in the speaker. */
  | "spoken"
  /** Written on the board in the Commons. Anyone may read it; the author may
   *  be unknown, so it is weighed by content and corroboration, not by trust. */
  | "noticeboard"
  /** The Directorate addressing everyone. High reach, institutional credibility,
   *  and a source many people actively distrust. */
  | "broadcast"
  /** Not a transfer at all — the world speaking directly. Strongest possible
   *  evidence, and the only channel that can inject truth into the system. */
  | "observation";

export interface Provenance {
  /** The claim this one was derived from, if it was passed on. */
  parentClaimId: number | null;
  /** The event that started the whole chain — usually an observation. */
  originEventId: number | null;
  /** How many mouths this has been through. 0 = first hand. */
  transmissionDepth: number;
}

/**
 * An immutable record that an assertion was made.
 *
 * Note what is NOT here: any notion of whether it is true, or of what the
 * audience concluded. A claim is a speech act, not an outcome.
 */
export interface InformationClaim {
  claimId: number;
  proposition: string;
  /** What the source asserted about it. */
  assertion: boolean;
  /** How confidently it was asserted, 0..1 — as STATED, which may be a lie. */
  statedConfidence: number;
  source: string;
  audience: string;
  channel: Channel;
  worldTime: number;
  provenance: Provenance;
}

let nextClaimId = 1;

export function makeClaim(
  sim: Sim,
  args: {
    proposition: string;
    assertion: boolean;
    statedConfidence: number;
    source: string;
    audience: string;
    channel: Channel;
    parent?: InformationClaim | null;
    originEventId?: number | null;
  }
): InformationClaim {
  const parent = args.parent ?? null;
  return {
    claimId: nextClaimId++,
    proposition: args.proposition,
    assertion: args.assertion,
    statedConfidence: args.statedConfidence,
    source: args.source,
    audience: args.audience,
    channel: args.channel,
    worldTime: sim.worldTime,
    provenance: {
      parentClaimId: parent?.claimId ?? null,
      // Origin is inherited, not recomputed, so the root survives any number
      // of retellings. This is what makes the chain traversable at depth 9.
      originEventId: parent?.provenance.originEventId ?? args.originEventId ?? null,
      transmissionDepth: parent ? parent.provenance.transmissionDepth + 1 : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Receiver-side evaluation
// ---------------------------------------------------------------------------

export interface Reception {
  /** How much weight the receiver gave the source, 0..1. */
  credibility: number;
  credenceBefore: number;
  credenceAfter: number;
  /** Did this land hard enough to be worth remembering? */
  remembered: boolean;
}

/**
 * How credible is this source, to THIS receiver, over THIS channel?
 *
 * Channel matters independently of source. A notice on the board carries no
 * personal trust — nobody signed it — so it is weighed by reach and by whether
 * it agrees with what you already think. A broadcast from the Directorate has
 * institutional weight and institutional suspicion at the same time.
 */
function credibilityOf(a: Agent, claim: InformationClaim): number {
  const t = trustIn(a, claim.source);

  switch (claim.channel) {
    case "observation":
      return 1;
    case "spoken":
      // Trust dominates. |t| scales how much the source matters at all;
      // strangers still carry a floor, because people do listen to strangers.
      return Math.abs(t) * 0.6 + 0.4;
    case "noticeboard":
      // Anonymous by default: weighed by the medium, not the author. Slightly
      // discounted, because anyone can write on a board.
      return 0.45 + Math.max(0, t) * 0.25;
    case "broadcast":
      // Institutional. Credulous agents defer to it; sceptics discount it hard.
      return 0.3 + a.identity.personality.credulity * 0.5 + Math.max(0, t) * 0.2;
  }
}

/**
 * Deliver a claim to one agent and let them decide what it means.
 *
 * Everything here is the RECEIVER acting. The claim is read, never written.
 */
export function receive(
  sim: Sim,
  agentId: string,
  claim: InformationClaim,
  prop?: Proposition
): Reception | null {
  const a = sim.byId.get(agentId);
  if (!a) return null;

  // A source nobody has an opinion about is not a stranger off the street —
  // in a sealed shelter they are a fellow resident. Modest standing, and a
  // real trust-graph entry from here on, so lying costs them later.
  if (!a.trust.has(claim.source) && claim.channel !== "observation") {
    a.trust.set(claim.source, 0.2);
  }

  const credibility = credibilityOf(a, claim);
  const before = believe(a, claim.proposition, sim.tick).credence;

  updateFromTestimony(
    a,
    claim.proposition,
    claim.assertion,
    claim.statedConfidence * credibility,
    claim.source,
    sim.tick
  );

  const b = a.beliefs.get(claim.proposition)!;

  // FIRST-HAND vs HEARSAY. A witnessed report carries far more confidence than
  // something passed along. Without this distinction a single telling leaves
  // the listener below the threshold at which they will repeat anything, and
  // information dies one hop from its source.
  if (claim.provenance.transmissionDepth === 0 && claim.channel !== "broadcast") {
    b.confidence = Math.min(1, b.confidence + 0.34 * credibility * claim.statedConfidence);
  }

  const salience = prop?.salience ?? 0.5;
  const surprise = Math.abs((claim.assertion ? 1 : 0) - before);
  // Remember what was surprising or important, not everything heard. Weighting
  // by prediction error is what keeps a memory store from being a transcript.
  const importance = Math.min(1, salience * (0.3 + surprise));
  const worthRemembering = importance > 0.25;

  if (worthRemembering) {
    remember(a, {
      tick: sim.tick,
      kind: "told",
      about: claim.proposition,
      participants: [claim.source],
      where: `level${a.level}`,
      importance,
      valence: claim.assertion ? -0.2 : 0.05,
      confidence: 0.85,
    });
  }

  return {
    credibility,
    credenceBefore: before,
    credenceAfter: b.credence,
    remembered: worthRemembering,
  };
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * A registry of claims, so a chain can be walked after the fact.
 *
 * Bounded, because the server runs forever. Losing the tail of very old
 * provenance is acceptable; losing the ability to explain a live belief is not.
 */
export class ClaimLog {
  private claims = new Map<number, InformationClaim>();
  private order: number[] = [];

  constructor(private capacity = 50_000) {}

  record(c: InformationClaim): InformationClaim {
    this.claims.set(c.claimId, c);
    this.order.push(c.claimId);
    if (this.order.length > this.capacity) {
      const dropped = this.order.shift()!;
      this.claims.delete(dropped);
    }
    return c;
  }

  get(id: number): InformationClaim | undefined {
    return this.claims.get(id);
  }

  /** Walk from a claim back to whoever started it. The "why" query. */
  chain(claimId: number): InformationClaim[] {
    const out: InformationClaim[] = [];
    let cur = this.claims.get(claimId);
    while (cur) {
      out.unshift(cur);
      cur = cur.provenance.parentClaimId === null
        ? undefined
        : this.claims.get(cur.provenance.parentClaimId);
    }
    return out;
  }

  /** Human-readable chain, for the "why does X believe this?" view. */
  explain(claimId: number): string[] {
    return this.chain(claimId).map(
      (c) =>
        `${c.source} → ${c.audience}  [${c.channel}]  ` +
        `${c.proposition}=${c.assertion}  (conf ${c.statedConfidence.toFixed(2)}, ` +
        `hop ${c.provenance.transmissionDepth})`
    );
  }

  get size(): number {
    return this.claims.size;
  }
}
