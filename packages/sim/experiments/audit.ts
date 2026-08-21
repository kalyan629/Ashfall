/**
 * Run the causal audit against a live simulation.
 *
 *   npm run audit --workspace=@ashfall/sim
 *
 * Exits non-zero if any subsystem produced output that nothing consumed, so
 * this is CI-able: "did we just add another beautifully-commented subsystem
 * that changes nothing?" becomes a build failure rather than a discovery weeks
 * later.
 */

import { audit, formatAudit } from "../src/audit.js";
import { createSim, step, tell } from "../src/sim.js";

const TICKS = 3000;

const sim = createSim({
  seed: 11,
  population: 60,
  memoryMode: "episodic",
  logCapacity: 2_000_000,
  investigateRate: 0.0006,
});

// Warm up, then inject one external claim so the perception->belief edge has
// a non-observation source too.
for (let i = 0; i < 300; i++) step(sim);
tell(sim, "a12", "scrubber_broken", true, 0.85, "player:kalyan");
for (let i = 0; i < TICKS; i++) step(sim);

console.log("ASHFALL — causal audit");
console.log(`population 60, ${TICKS + 300} ticks, episodic memory\n`);
console.log(formatAudit(audit(sim.log)));

const report = audit(sim.log);
if (report.anyDead) {
  console.log("\n  FAIL: a subsystem produced output that nothing consumed.");
  process.exit(1);
}
console.log("\n  PASS: every stage feeds the next.");
