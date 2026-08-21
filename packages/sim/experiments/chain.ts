/**
 * THE CAUSAL CHAIN.
 *
 *   npm run chain --workspace=@ashfall/sim
 *
 * One sentence enters the population from outside, and we follow it all the
 * way to somebody physically going to look at a machine:
 *
 *   PLAYER  "the east scrubber is broken"
 *     -> credibility evaluation
 *     -> belief update
 *     -> memory formation
 *     -> goal change
 *     -> onward gossip
 *     -> second survivor's belief update
 *     -> second survivor's goal change
 *     -> a competent scrubber inspects it
 *     -> observation confirms the world
 *
 * No LLM is involved at any point. The test of whether the cognition is real
 * is whether that chain forms on its own from utilities, and whether cutting
 * one link measurably breaks it.
 *
 * The control matters as much as the run: CONTROL tells nobody and measures
 * how far the belief spreads on its own. If the treated and control arms end
 * up the same, the player did not actually do anything.
 */

import { createSim, measure, step, tell, type Sim } from "../src/sim.js";
import { describe, type SimEvent } from "../src/events.js";
import { COMPETENCE } from "../src/goals.js";

const PROP = "scrubber_broken";
const WARMUP = 400;
const OBSERVE = 2500;

function warm(seed: number): Sim {
  const sim = createSim({
    seed,
    population: 60,
    memoryMode: "episodic",
    // Keep the whole trace. The default 20k ring buffer silently EVICTED the
    // root event and its descendants, so the chain looked broken while the
    // action counts proved it had actually run. A truncated log is a lie.
    logCapacity: 500000,
    // Going to look must be RARE. At the old rate 25 of 60 survivors simply
    // walked over and checked the scrubber themselves, which makes testimony
    // irrelevant and collapses the treated and control arms onto each other.
    // Investigation is expensive in a bunker; that is why gossip exists.
    investigateRate: 0.00015,
  });
  for (let i = 0; i < WARMUP; i++) step(sim);
  return sim;
}

/** How many agents hold this belief above 0.5, and how sure are they. */
function spread(sim: Sim, prop: string) {
  let believers = 0;
  let confident = 0;
  for (const a of sim.agents) {
    const b = a.beliefs.get(prop);
    if (!b) continue;
    if (b.credence > 0.5 && b.confidence > 0.08) {
      believers++;
      if (b.confidence > 0.35) confident++;
    }
  }
  return { believers, confident };
}

console.log("ASHFALL — causal chain: one sentence into a population of 60\n");

// ---------------------------------------------------------------------------
// Treated run
// ---------------------------------------------------------------------------
const sim = warm(7);

// Pick a talkative survivor who is NOT a scrubber, so the chain has to travel
// through at least one other person before anyone competent can act.
const seedAgent =
  sim.agents
    .filter((a) => a.identity.occupation !== "scrubber")
    .sort((x, y) => y.identity.personality.sociability - x.identity.personality.sociability)[0];

const scrubbers = sim.agents.filter((a) =>
  (COMPETENCE[a.identity.occupation] ?? []).includes(PROP)
);

console.log(`told:      ${seedAgent.identity.id} (${seedAgent.identity.occupation}, ` +
  `sociability ${seedAgent.identity.personality.sociability.toFixed(2)})`);
console.log(`competent: ${scrubbers.length} scrubbers in the population`);
console.log(`world:     ${PROP} is actually ${sim.props.find((p) => p.id === PROP)!.truth}\n`);

const before = spread(sim, PROP);
sim.log.clear();

const rootId = tell(sim, seedAgent.identity.id, PROP, true, 0.85, "player:kalyan");
for (let i = 0; i < OBSERVE; i++) step(sim);

const after = spread(sim, PROP);

// ---------------------------------------------------------------------------
// Control run — identical seed, nobody told
// ---------------------------------------------------------------------------
const control = warm(7);
control.log.clear();
for (let i = 0; i < OBSERVE; i++) step(control);
const ctrl = spread(control, PROP);

// ---------------------------------------------------------------------------
// The trace
// ---------------------------------------------------------------------------
console.log("--- causal trace (first 22 events descended from the sentence) ---");
const descended = rootId === null ? [] : sim.log.descendants(rootId);
const root = rootId === null ? undefined : sim.log.byId(rootId);
if (root) console.log(`  [${String(root.tick).padStart(5)}] ${describe(root)}`);
for (const e of descended.slice(0, 22)) {
  console.log(`  [${String(e.tick).padStart(5)}] ${describe(e)}`);
}

// ---------------------------------------------------------------------------
// Did the chain actually reach an action?
// ---------------------------------------------------------------------------
const relevant = (e: SimEvent) => "prop" in e && e.prop === PROP;

const rumours = sim.log.of("rumour_transmitted").filter(relevant);
const goalChanges = sim.log
  .of("goal_changed")
  .filter((e) => e.t === "goal_changed" && (e.to.startsWith("repair") || e.to.startsWith("warn")));
const inspections = sim.log
  .of("action_completed")
  .filter((e) => e.t === "action_completed" && e.action.includes(PROP));
const observations = sim.log.of("observation").filter(relevant);

console.log("\n--- did the chain close? ---");
console.log(`  rumours about ${PROP}     : ${rumours.length}`);
console.log(`  goal changes to warn/repair: ${goalChanges.length}`);
console.log(`  survivors who went to look : ${observations.length}`);
console.log(`  inspections while goal=repair: ${inspections.length}`);

console.log("\n--- spread vs control (same seed, nobody told) ---");
console.log(`  before telling : ${before.believers}/60 believe, ${before.confident} confidently`);
console.log(`  treated        : ${after.believers}/60 believe, ${after.confident} confidently`);
console.log(`  control        : ${ctrl.believers}/60 believe, ${ctrl.confident} confidently`);
console.log(`  attributable   : ${after.believers - ctrl.believers} extra believers`);

const closed =
  rumours.length > 0 && goalChanges.length > 0 && observations.length > 0;
console.log(
  `\n  VERDICT: ${
    closed
      ? "chain closed — one sentence changed beliefs, goals and behaviour"
      : "CHAIN BROKEN — a link is missing, see counts above"
  }`
);
