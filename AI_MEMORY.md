# AI_MEMORY — dated history

> Append-only. Newest at the bottom. Add an INDEX line for every entry.
> Never delete. When a later finding overturns an earlier one, mark the old
> block `SUPERSEDED — see <date>` in place.
> Current-state facts belong in `PROJECT_MAP.md`, not here.

## INDEX

- 2026-08-21 — Project started. Scope, stack, and location decided. Repo scaffolded.
- 2026-08-21 (later) — Design redirect: the bunker IS the open world. Wards replace the injector. Fauna, Directorate, holding ground added. Roadmap re-ordered.

---

## 2026-08-21 — Project started

**Idea.** Apocalyptic open-world survival game. Humanity believed wiped out by an
unknown catastrophe; millions live in enormous underground bunkers. The surface is
dangerous, mysterious, largely unexplored. The core ambition is the *Ready Player
One* property: one connected world where players genuinely meet and survive together.

**Scope decision.** Full OASIS scale is ~100 person-years, so it is not attempted.
The soul is kept and the surface area cut: one persistent bunker where real players
coexist, plus procedurally generated surface expeditions. Same architecture scales
to many bunkers later by adding shards.

**Machine recon (measured, not assumed).**
- Laptop: Dell XPS 15 7590, i7-9750H 6C/12T, 15.7 GB RAM, GTX 1650 4 GB.
- Local: Node 24.17, npm 11.13, git 2.54 present. Python blocked by Windows App
  Control. No .NET, no Godot, no Unity.
- Kipchoge: 72-core Xeon E5-2697v4, 503 GB RAM, 4× GTX 1080 Ti (11 GB each),
  42 TB at 71% used, Ubuntu 26.04, load 0.35 at time of check.

**Stack decision: TypeScript + Three.js + authoritative Node server.**
Reasons, in order of weight: (1) players join by URL with no install, which is the
only way the "everyone meets" premise actually happens; (2) it is the only working
toolchain on the laptop; (3) GTX 1650 4 GB makes UE5 iteration impractical.
UE5 and Godot were both considered and rejected — Godot would also have required
a download for every player.

**Location decision: `C:\dev\ashfall`, outside OneDrive.** node_modules is ~30k
small files; OneDrive sync on that causes file-lock failures and git index
corruption. The research workspace is untouched.

**Kipchoge decision: compute, not hosting.** It is behind `gate.ucd.ie` VPN, so it
could not serve public players even if that were appropriate. It is also a shared
research server and the team's paper is due 2026-08-22. Role is asset generation,
CI, load testing, and VPN-only playtests.

**Discovery — `interior` is the unfair advantage.** `/homekipchoge/kalyanb/interior`
(17 GB) is an existing working 4-GPU Stable Diffusion pipeline: `timing_rank0-3.json`
confirms one rank per 1080 Ti, generating interior mood boards (`A_walnut_ivory`,
`B_travertine_cane`, `C_terracotta_greige`) plus contact sheets. Its `env.sh`
redirects every cache (HF, torch, uv, pip, mpl, xdg) into the project root and
guards venv activation with `if` rather than `[ ] &&` so `set -e` callers survive a
missing venv. Content is what kills solo game projects; this pipeline becomes the
game's asset foundry and the `env.sh` pattern is reused verbatim.

**Scaffolded.** `packages/{shared,server,client}`, `docs/`, root workspace
`package.json`, `.gitignore`, `ROADMAP.md`, `PROJECT_MAP.md`, this file. Git
initialised. No remote yet.

## 2026-08-21 (later) — Design redirect: the bunker IS the open world

Kalyan redirected the design substantially. Draft 1 of WORLD.md is SUPERSEDED.

**Changed:**
- The endgame is no longer "reach an injector". It is **seven buried wards**,
  five of which must be present simultaneously to open the Headworks Gate
  (k-of-n threshold control as level design). Reaching one target ends too easily.
- **The bunker is the entire open world.** Marrow scaled from a 1,100-person mine
  to a 60 km, nine-level, ~90,000-person city. The surface becomes an expansion
  (Phase 9), not a launch requirement. Better scoping than the original plan:
  interiors give working occlusion and streaming on modest hardware.
- **Difficulty is deliberately tuned so most players never finish the ward hunt.**
  The wards are the horizon; living in Marrow is the content. Guard against the
  failure mode by making every ward a public, server-wide, permanent unlock.
- **Fauna added.** The ash was engineered human-safe by design; every other
  vertebrate was outside tolerance. Drift, Choir, Sow, the Long. Animals, not
  monsters - hungry and territorial, never hateful.
- **The Directorate and Custody added.** Scrip denominated in hours, shops in the
  Commons. Core tension: the Directorate employs players to scavenge the deep
  AND cannot allow the wards to be found. Your employer is your antagonist.
- **Holding ground added** as the adrenaline core: claimable derelict sectors,
  fortification that Sows break, registered-vs-squatted tenancy.

**Roadmap re-ordered:** old Phase 5 (Surface) became Phase 9 (expansion). New
Phase 5 is the deep and the fauna; new Phase 6 is holding ground; Phase 8 is the
ward hunt shipping incrementally.

**Phase 4 not started yet** - deliberately gated on this redirect. The art
direction changed materially (Custody reads printed, everyone else hand-made;
deep-level palette added), which is exactly why the smoke-test gate existed.
