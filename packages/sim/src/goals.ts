/**
 * Goal selection by utility.
 *
 * THIS FILE EXISTS TO CLOSE A SPECIFIC CAUSAL GAP. Before it, beliefs were
 * read in exactly one place — choosing what to talk about — and could not
 * change what a survivor did. An agent could be certain the east scrubber was
 * failing and would still wander to the canteen. Beliefs that cannot alter
 * behaviour are decoration, and an ablation over them measures nothing.
 *
 * Now every goal's utility is a function of needs AND beliefs AND personality
 * AND occupation, so:
 *
 *   - occupation is no longer a lookup table that pins a body to a location.
 *     It raises the utility of goals that agent is competent to pursue, and
 *     the LOCATION FALLS OUT of the goal. Occupation causes spatial behaviour
 *     rather than dictating it.
 *   - two survivors in identical circumstances with different beliefs choose
 *     different goals. That is the whole point of modelling belief separately
 *     from world truth.
 *   - being told something can change where a person walks, which is the link
 *     that makes information propagation observable in the world.
 */

import type { Agent } from "./agent.js";
import type { Proposition } from "./core.js";

export type GoalKind =
  | "eat"
  | "drink"
  | "rest"
  | "socialise"
  | "work"
  | "investigate"
  | "repair"
  | "warn";

export interface Goal {
  kind: GoalKind;
  utility: number;
  /** Proposition this goal is about, for investigate / repair / warn. */
  prop?: string;
  /** Short human-readable justification, carried into the event log. */
  reason: string;
}

/**
 * Which occupation is competent to act on which proposition.
 *
 * Competence is what turns a belief into a *plan*. A grower who believes the
 * scrubber is broken can only gossip about it; a scrubber can go and fix it.
 * Same belief, different behaviour, because of identity — which is exactly the
 * kind of differentiation the population needs.
 */
export const COMPETENCE: Record<string, string[]> = {
  scrubber: ["scrubber_broken", "air_foul"],
  grower: ["grow_failing"],
  digger: ["l8_creature", "l8_ward", "l8_riches"],
  custody: ["directorate_knew"],
  trader: [],
  idle: [],
};

/** How uncertain is this belief? Peaks at credence 0.5 — maximum ignorance. */
function uncertainty(credence: number, confidence: number): number {
  return (1 - Math.abs(credence - 0.5) * 2) * (1 - confidence);
}

/**
 * Score every candidate goal and return the best.
 *
 * Utilities are intentionally on a shared scale so they genuinely compete.
 * Needs are squared because urgency is non-linear: being 90% thirsty should
 * dominate almost everything, while being 30% thirsty should lose to work.
 */
export function selectGoal(a: Agent, props: readonly Proposition[], tick = 0): Goal {
  const n = a.needs;
  const p = a.identity.personality;
  const competent = COMPETENCE[a.identity.occupation] ?? [];

  const candidates: Goal[] = [
    { kind: "drink", utility: n.thirst * n.thirst * 1.25, reason: "thirst" },
    { kind: "eat", utility: n.hunger * n.hunger * 1.05, reason: "hunger" },
    { kind: "rest", utility: n.fatigue * n.fatigue * 0.85, reason: "fatigue" },
    {
      kind: "socialise",
      utility: n.social * 0.55 * (0.4 + p.sociability),
      reason: "social need",
    },
    // Baseline pull of the job. Low, so any real need outranks it — a thirsty
    // scrubber stops scrubbing, which is what needs are for.
    { kind: "work", utility: 0.3 + p.sociability * 0.05, reason: "routine" },
  ];

  for (const prop of props) {
    const b = a.beliefs.get(prop.id);
    if (!b) continue;

    /**
     * Belief strength: how much of the claim you hold, times how firmly.
     *
     * Kept as ONE factor deliberately. The first version multiplied credence,
     * confidence, salience and a personality trait together — four terms all
     * below 1 — so a survivor who had just been told the air scrubber was
     * failing scored 0.11 and lost to the 0.3 routine-work baseline. They
     * believed it and went back to work. Personality now MODULATES rather than
     * multiplying from zero, which keeps trait variation without letting it
     * annihilate the signal.
     */
    const strength = b.credence * b.confidence;

    // REPAIR — I believe something is wrong AND I am the one who can fix it.
    // This is the belief -> action edge that did not exist before.
    if (competent.includes(prop.id)) {
      candidates.push({
        kind: "repair",
        prop: prop.id,
        utility: strength * prop.salience * 3.5,
        reason: `believes ${prop.id} (${b.credence.toFixed(2)}) and is competent`,
      });
    }

    /**
     * NOVELTY. You tell people the news, not what everyone already knows.
     *
     * Without this the population reaches an attractor where every sociable
     * agent warns forever about whichever belief hardened first. Observed
     * directly: a50 sat permanently on warn(l8_creature) at utility 2.70, so a
     * fresh, true, urgent claim scoring 0.38 could never get a word in — the
     * chain "broke" purely because nobody had anything new to say.
     *
     * Two terms, each with a cognitive justification:
     *   freshness  — recently learned things feel urgent, and that fades.
     *   saturation — the more corroborations you have heard, the more you
     *                assume everyone already knows, so the less you bother.
     */
    const freshness = 0.35 + 1.9 * Math.pow(0.5, (tick - b.lastUpdated) / 250);
    const saturation = 1 / (1 + b.corroborations * 0.45);

    // WARN — I hold something that matters and I am the sort who passes it on.
    candidates.push({
      kind: "warn",
      prop: prop.id,
      utility:
        strength * prop.salience * (0.4 + 0.6 * p.sociability) * freshness * saturation * 3.0,
      reason: `wants to pass on ${prop.id}`,
    });

    // INVESTIGATE — I do NOT know, it matters, and I am bold enough to look.
    // Uncertainty is the driver, so agents seek out what they are unsure of
    // rather than confirming what they already believe.
    candidates.push({
      kind: "investigate",
      prop: prop.id,
      utility: uncertainty(b.credence, b.confidence) * prop.salience * p.boldness * 1.1,
      reason: `uncertain about ${prop.id}`,
    });
  }

  let best = candidates[0];
  for (const c of candidates) if (c.utility > best.utility) best = c;
  return best;
}

/**
 * Hysteresis: do not switch goals for a marginal utility gain.
 *
 * Without this an agent oscillates between two near-equal goals every tick and
 * spends its life turning around in a corridor. The threshold is what makes
 * behaviour look committed rather than twitchy, and it is cheap.
 */
export function shouldSwitch(currentUtility: number, candidate: Goal): boolean {
  return candidate.utility > currentUtility * 1.18 + 0.03;
}
