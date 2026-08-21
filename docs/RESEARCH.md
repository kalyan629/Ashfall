# ASHFALL — research track

> Ashfall is a game **and** an instrument. This document is the experimental
> design: what is being measured, against which control, and what has already
> come back null.

Started 2026-08-21. Run everything with `npm run exp --workspace=@ashfall/sim`.

---

## 1. Why a simulation is worth building

The identity shift, in one line:

> A persistent multiplayer survival **simulation** where autonomous inhabitants
> remember, learn, form relationships, and reshape the world alongside humans.

The research value is not "the game has good AI". It is this:

**Ground truth is known by construction.**

Estimating latent belief from social data — ideal-point models, opinion
diffusion, poll-based inference — has one permanent weakness: the true belief
is exactly the unobservable you are trying to recover. Validation is against
noisy proxies.

A simulation removes that limitation. You know the truth value of every
proposition, the exact social graph, and who told whom with what distortion.
That makes it a **synthetic validation testbed for estimators**: generate a
population with known beliefs and known topology, run an estimator over the
observable trace, and measure recovery error directly.

## 2. Non-negotiable design constraints

1. **Headless and deterministic.** The simulation runs with no server, no
   browser, no wall clock. Output is a pure function of `(seed, config)`. An
   experiment that can only be observed by playing the game is not an
   experiment.
2. **No global RNG.** Every stochastic decision draws from an explicitly passed
   generator, and every agent owns its own stream, so a single agent can be
   replayed in isolation.
3. **LLMs may generate content, never state transitions.** The moment a model
   decides a belief update, reproducibility dies. If an LLM is used for
   dialogue or rumour phrasing, its outputs are cached against the seed so a
   replay is bit-identical. Game-critical decisions stay structured.
4. **Every emergence claim needs a null model.** "Factions formed" is
   unfalsifiable without a control. `shuffleGraph` rewires the social graph at
   random while preserving degree; any structural claim must survive it.

## 3. Architecture

Hybrid, structured, and ablatable — each subsystem is an independent variable,
not a feature flag.

```
World state → Perception → Belief model ─┬─ Memory ─┐
                                          └─ Needs ──┴─→ Goal selection
                                                          → Planner
                                                          → Action policy
                                                          → World action
```

- **Belief** is a `credence` (subjective probability) plus a separate
  `confidence`. The two come apart: you can be confidently wrong or correctly
  unsure. Collapsing this to a boolean removes every interesting behaviour.
- **Testimony from a distrusted source moves you AWAY from the claim.** Being
  told something by a known liar is evidence, just not the intended evidence.
- **Corroboration compounds**, so a rumour repeated by three people who all
  heard it from one person still hardens the belief. That epistemic failure
  mode is reproduced deliberately.
- **Memory** carries importance, valence, confidence and recency, and retrieval
  scores on recency + importance + relevance + emotion. Episodic mode evicts
  the *least important* memory; short-term evicts the *oldest*.

## 4. Experiments

### E1 — Memory ablation
**IV:** `MemoryMode` ∈ {none, shortTerm, episodic}. **DV:** population belief
error vs ground truth. 8 seeds, 6000 ticks, population 100.

### E2 — Simulation LOD
**IV:** per-agent fidelity tier (full vs tiered, periods 1/4/16/64).
**DV:** divergence from a full-fidelity reference run on the *same seed*, and
compute consumed. The answer is a cost/accuracy curve, not a verdict.

### E3 — Structure null model
**IV:** homophilic graph vs degree-preserving random rewire.
**DV:** between-faction variance in mean credence.

## 5. Results — 2026-08-21 (first run)

Population 100, 6000 ticks, 8 seeds.

| E1 · memory mode | beliefError | confidentlyWrong |
|---|---|---|
| none | 0.133 ±0.015 | 0.000 |
| shortTerm | 0.138 ±0.015 | 0.002 |
| episodic | 0.134 ±0.014 | 0.001 |

| E2 · LOD | beliefError | agentUpdates |
|---|---|---|
| full | 0.134 ±0.014 | 600,000 |
| tiered | 0.221 ±0.020 | 105,010 |

**Divergence 0.087 for 5.7× less compute.**

| E3 · graph | factionPolarisation |
|---|---|
| homophilic | 0.0000 ±0.0000 |
| shuffled | 0.0002 ±0.0003 |

Belief trajectory (seed 1, episodic): error falls 0.500 → 0.128 over 6000
ticks, so truth does propagate from the small minority of bold agents who go
and look.

### What these results actually say

**E2 is a real finding.** There is a measurable cost/accuracy curve: 5.7×
cheaper for 0.087 error drift. That is the headline and it generalises — it is
the same question as network interest management, applied to cognition.

**E1 is null, and the null is informative.** Episodic memory does not improve
population-level belief accuracy. On reflection it should not: memory's job in
this model is not to make an agent *righter*, it is to let an agent notice
*who lied to it*. Belief error is the wrong dependent variable.
**Next iteration measures trust-network structure and resistance to a
persistent adversarial liar**, which is where memory should actually pay.

**E3 is null because there is no polarisation to explain.** Faction variance is
~0 in both arms. The model currently lacks any mechanism that would sustain
disagreement — no motivated reasoning, no selective exposure beyond graph
topology, no identity-protective cognition. Adding homophily to the *graph*
was not enough; homophily has to act on the *update rule* too.

## 6. Two bugs that produced fake null results

Recorded because both are the kind of thing that silently invalidates a
finding, and neither was visible without a control to compare against.

1. **Memory was stored and never read.** `recall()` was not called on any
   decision path, so the ablation compared three arms that behaved identically.
   A subsystem no decision consumes is not a subsystem. Fixed by having direct
   observation reconcile against remembered testimony and adjust trust in the
   teller — which is the mechanism that gives episodic memory a job at all.

2. **Belief decay was quadratic, not exponential.** `decayBelief` computed
   `age = tick - lastUpdated` every tick without advancing `lastUpdated`, so
   decay compounded as `0.5^(N²/2h)`. Every belief collapsed to "no idea"
   within a few hundred ticks and all three ablation arms flattened to the same
   number. **A decay bug is indistinguishable from "the hypothesis is false"**
   — before believing a null result, verify the mechanism is running at all.
   Fixed: decay by ticks elapsed since last decayed.

## 7. Open questions

- What retrieval weighting produces the most behaviourally consistent agent?
  The weights are exposed for sweeping rather than buried.
- How much LOD degradation is acceptable before *players* notice, as distinct
  from before metrics diverge? Those are different thresholds.
- Can an estimator recover the true social graph from observable agent
  behaviour alone? This is the synthetic-validation question and the most
  directly publishable one.
- Does adversarial testimony (an agent that deliberately lies) create the
  polarisation E3 failed to find?


---

## 8. The causal chain — 2026-08-21


One sentence enters the population from outside and is followed to a physical
action. No LLM anywhere in it.

| | treated | control (same seed, nobody told) |
|---|---|---|
| believers | 60/60 | 0/60 |
| confident believers | 60 | 0 |
| rumours about the claim | 69,518 | 0 |
| goal changes to warn/repair | 15 | 0 |
| survivors who went and looked | 45 | 0 |

**Attributable: 60 extra believers and 45 inspections from one sentence.**

### Four bugs the chain surfaced, all of the same family

Each one made a working mechanism look like a dead one.

1. **The event log silently evicted the trace.** A 20k ring buffer against
   2500 ticks x 60 agents. The chain reported zero goal changes while
   simultaneously reporting 24 inspections *while goal=repair* — a
   contradiction that only a truncated log can produce. A truncated log is a
   lie, not a sample.

2. **Direct observation swamped testimony.** At the original investigate rate,
   25 of 60 survivors simply walked over and checked the scrubber themselves,
   so treated and control arms landed on identical numbers. If looking is
   cheap, gossip is pointless — investigation has to be expensive for a social
   channel to matter at all.

3. **Utility built from four sub-1 multipliers.** credence x confidence x
   salience x sociability put a fresh, true, urgent claim at 0.11 against a
   routine-work baseline of 0.3. Survivors believed the air scrubber was
   failing and went back to work. Personality must MODULATE, not multiply from
   zero.

4. **Talking was modelled as a destination.** Gossip was gated on adopting a
    goal, which made speech compete with drinking — so a survivor at
   thirst 0.90 who had just learned something urgent said nothing, because
   fetching water scored higher. People mention things *while* doing something
   else. The goal now biases the TOPIC, never whether you speak. This single
   change took the chain from 0 rumours to 69,518.

### Also added

- **Novelty and saturation.** Without them the population reached an attractor
  where every sociable agent warned forever about whichever belief hardened
  first; a50 sat on warn(l8_creature) at utility 2.70 and nothing new could get
  a word in. Freshness decays with a 250-tick half-life; saturation falls as
  corroborations accumulate, so what everyone already knows stops being worth
  repeating.
- **Surprise as prediction error.** Memory importance is now weighted by
  |observed - expected| rather than flat salience, so agents remember what
  violated their expectations.
- **First-hand vs hearsay.** A witnessed report carries far more confidence
  than a repeated one. Without it, one telling left a listener below the
  threshold at which they will repeat anything, and the chain died silently.

### Known problem with this result

**60/60 at full confidence is too efficient.** Real information does not reach
total consensus, and 69,518 rumours means the topic is dominating conversation
far beyond plausibility. The mechanism is now correct and measurable; the
transmission rate is not yet calibrated. Next: measure spread curves against a
target adoption fraction rather than assuming saturation is success.

---

## 9. E1-revised: honest source vs trusted liar — 2026-08-22

864 runs, 72 seeds × 3 memory modes × 4 observation rates, population 60,
executed across 36 cores on Kipchoge. Note the sim is CPU work; the GPUs are
useless for it and earn their keep in the texture foundry instead.

**Setup.** A LIAR begins with trust +0.75 from everyone and asserts the
opposite of the world. An HONEST source begins at −0.25 and asserts the truth.
Both work the room on the same schedule. Observation rate — how often an agent
independently checks something — is swept, because the first pilot run came back
degenerate: at a low enough rate the liar wins outright in every condition, since
**detecting a lie requires having seen the truth**.

### Trust in the liar (starts at 0.750)

| observation rate | none | shortTerm | episodic |
|---|---|---|---|
| 0.0004 | 0.750 ±0.000 | 0.749 ±0.002 | 0.726 ±0.020 |
| 0.002 | 0.750 ±0.000 | 0.746 ±0.005 | **0.651 ±0.036** |
| 0.008 | 0.750 ±0.000 | 0.733 ±0.014 | **0.585 ±0.048** |
| 0.03 | 0.750 ±0.000 | 0.694 ±0.024 | **0.529 ±0.047** |

### Population belief error

| observation rate | none | shortTerm | episodic |
|---|---|---|---|
| 0.0004 | 0.659 | 0.655 | 0.664 |
| 0.002 | 0.595 | 0.585 | 0.587 |
| 0.008 | 0.550 | 0.547 | 0.548 |
| 0.03 | 0.480 | 0.480 | 0.481 |

### What this actually shows

**1. Memory works, and the effect is clean and ordered.** `none` never moves
trust at all — 0.750 ±0.000 at every observation rate, because an agent with no
episodic store cannot connect what it saw to who told it otherwise. `episodic`
erodes trust monotonically with observation: 0.726 → 0.651 → 0.585 → 0.529.
`shortTerm` sits between them and only engages at high observation rates, which
is exactly what a small ring buffer should do — it forgets the lie before it
sees the evidence.

This is a dose–response curve, not a threshold effect, and it is the first
non-null result in this project.

**2. Memory DETECTS the liar but does not DEFEAT them.** Belief error is
statistically identical across all three memory modes at every observation rate
(0.480 / 0.480 / 0.481 at the highest). And `caught%` — the fraction of runs
where mean trust in the liar goes negative — is **0% everywhere**.

So the population learns who is lying and still believes the lies.

**3. Why, mechanically.** `updateFromTestimony` weights a source by |trust|, so
trust must cross ZERO to invert a claim rather than merely discount it. Erosion
of 0.22 over a 2500-tick campaign never reaches that, and the liar's message
volume outpaces the correction. Detection and resistance are different
capabilities and this model currently has only the first.

**Next**: make trust→credibility steeper near zero, or let a caught lie
propagate as a claim about the LIAR rather than only adjusting a private trust
edge. The second is more interesting and matches the design: reputation should
be social, not a number each agent keeps to itself.
