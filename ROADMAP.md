# ASHFALL — Roadmap

> An apocalyptic survival game where a persistent underground bunker is shared
> by real players, and the surface is a dangerous, procedurally generated unknown.

Owner: Kalyan · Started 2026-08-21 · Codename `ashfall` (rename freely)

---

## 1. The honest scope

A true OASIS-scale world is roughly 100 person-years of work. This project does
not attempt that. It keeps the **soul** of the idea and cuts the surface area:

- **Not**: an infinite planet with millions of concurrent players.
- **Instead**: *one* persistent bunker where real players genuinely coexist —
  walk around, see each other, talk, build, trade, share power and water — plus
  dangerous expeditions to a procedurally generated surface above it.

The architecture that runs 1 bunker of 50 players is the *same* architecture
that runs 10,000 bunkers. Scaling is adding shards, not rewriting.

## 2. Why this is buildable by one data engineer

The hard part of a shared world is **not** graphics. It is authoritative
distributed state: ticks, event streams, hot/cold storage, sharding, idempotent
writes, replay-on-restart. That is Kalyan's day job. This project is strong
exactly where solo game devs are weak.

## 3. Constraints of record

| Thing | Reality |
|---|---|
| Dev laptop | Dell XPS 15 7590 · i7-9750H 6C/12T · 15.7 GB RAM · **GTX 1650 4 GB** |
| Local Python | **BLOCKED** by Windows Application Control (error 4551) since ~2026-07-11 |
| Local .NET / Unity / Godot | not installed |
| Local Node / npm / git | Node 24.17, npm 11.13, git 2.54 — all working |
| Kipchoge | 72-core Xeon E5-2697v4 · 503 GB RAM · **4× GTX 1080 Ti** · 42 TB · Ubuntu 26.04 |
| Kipchoge reachability | behind `gate.ucd.ie` VPN — **cannot serve public players** |

## 4. Decisions of record

### 4.1 Stack: TypeScript everywhere

Three.js client in the browser, authoritative Node server, shared protocol package.

- Only toolchain that actually runs on the laptop (Python blocked, no .NET).
- GTX 1650 4 GB makes Unreal 5 impractical for iteration.
- **Decisive**: players join by clicking a URL. No install, no store, no build to
  download. That friction is precisely what kills "everyone meets in the world".
- Netcode and architecture skills port 1:1 to Godot/Unreal later if ever needed.

### 4.2 Repo lives at `C:\dev\ashfall` — outside OneDrive

`node_modules` is ~30k small files. OneDrive tries to sync every one, causing
file-lock failures, slow installs, and genuine git index corruption.
`OneDrive\Desktop\project workspace` is the research work and is **not touched**.

### 4.3 Kipchoge's role: compute, not hosting

- YES: building, testing, CI, load-generation, **asset generation** (section 6).
- YES: private playtests over VPN.
- NO: public game hosting. It is VPN-gated, it is a shared research server, and
  a long-lived listening process on an open port is a different risk class from
  a batch job. Revisit only with the server's admin, and never during a paper
  crunch.

### 4.4 Server is a single portable Node process

Deploys identically to laptop, Kipchoge, or a VPS. The hosting decision stays
open instead of being made by accident.

---

## 5. Phases

Every phase ends with something **playable** and something **showable**.
Nothing is built that is not playable within a month.

### Phase 0 — Foundation · week 1

Repo, TypeScript monorepo, netcode skeleton.

**Ships:** two browser tabs, two avatars, moving in real time on one authoritative server.
**Concepts:** authoritative server, fixed-timestep tick loop, wire protocol, monorepo.

### Phase 1 — The Bunker · ~1 month

**Ships:** a real 3D bunker interior. Avatars with collision. Nametags. Proximity chat.
**Concepts:** scene graph, client-side prediction, server reconciliation,
snapshot interpolation, input buffering.

### Phase 2 — Persistence · ~1 month

**Ships:** log out, log in tomorrow, the world remembers. Accounts, inventory, DB.
**Concepts:** event sourcing, hot state vs cold state, idempotent writes,
crash-safe snapshotting, replay-on-restart.

### Phase 3 — Survival loop · ~2 months

**Ships:** hunger, thirst, power, water. Shared bunker resources that players
maintain together. Crafting. Jobs.
**Concepts:** game economy design, server-side validation, anti-cheat, rate limiting.

### Phase 4 — Asset foundry · ~2 weeks, runs in parallel

Reuse the existing `interior/` diffusion pipeline on Kipchoge's 4× 1080 Ti.

**Ships:** tileable PBR textures, prop concept sheets, skyboxes, UI art.
**Concepts:** diffusion → PBR maps, seamless tiling, texture atlasing, KTX2/basis
compression, draw-call budgeting.

### Phase 5 — The Surface · ~2–3 months

**Ships:** the airlock opens. Procedurally generated ruins, weather, hazards,
loot runs with real risk.
**Concepts:** seeded deterministic procgen, noise fields, chunk streaming, LOD,
frustum/occlusion culling.

### Phase 6 — Scale · ~2 months

**Ships:** many bunkers, 50+ concurrent players, load tests that prove it.
**Concepts:** interest management (area-of-interest + spatial hashing), delta
compression, sharding, backpressure, observability.

### Phase 7 — Meaning · ongoing

**Ships:** the mystery. What actually happened up there.
**Concepts:** quest state machines, world events, emergent narrative.

---

## 6. Asset strategy — the unfair advantage

Content, not code, is what kills solo game projects. Nobody hand-models 400 props.

`/homekipchoge/kalyanb/interior` is already a working 4-GPU Stable Diffusion
pipeline producing interior mood boards with per-rank timing telemetry. Its
`env.sh` pattern (redirect HF/torch/uv/pip/mpl caches into the project root,
guard venv activation so `set -e` callers survive a missing venv) is proven and
gets reused verbatim for the game's asset foundry.

Pipeline: prompt → diffusion → tileable texture → PBR maps → compressed GPU
texture → Three.js material.

---

## 7. Glossary — concepts introduced by this project

| Term | Meaning |
|---|---|
| **Authoritative server** | The client asks; the server decides. Never trust the client or you get flying speedhackers on day one. |
| **Tick rate** | The server simulates in fixed steps (20 Hz here). Determinism and fairness depend on it. |
| **Client-side prediction** | The client applies your input immediately instead of waiting for the server, so movement feels instant on 120 ms ping. |
| **Server reconciliation** | When the server's truth disagrees with the prediction, the client rewinds and replays. |
| **Snapshot interpolation** | Other players are rendered ~100 ms in the past so their motion is smooth instead of teleporting. |
| **Interest management (AoI)** | Never send a player the whole world — only their ~50 m bubble. The single most important scaling primitive. |
| **ECS** | Entity Component System. Data-oriented architecture; feels like columnar data engineering, not OOP. |
| **Seeded procgen** | The surface is not stored, it is *derived* from a seed. Infinite world, near-zero bytes. |
| **Event sourcing** | Every action is an append-only event; world state is a fold over the log. |
| **Vertical slice** | One small piece built to shipping quality, instead of ten things at 20%. |
| **Game feel** | The tactile quality of control. Mostly camera, acceleration curves, audio, screen shake. Cheap to add, decides whether the game is fun. |

---

## 8. How this project is maintained

Mirrors the discipline already proven on the research project:

- **`PROJECT_MAP.md`** — what is true *right now*. Rewritten in place. Read first.
- **`AI_MEMORY.md`** — dated append-only history. Never deleted; superseded
  entries marked in place.
- **`ROADMAP.md`** (this file) — direction and decisions of record.
- One log, never a per-machine fork. That mistake cost a month in July 2026.
- Every phase is a git branch, merged only when its slice is playable.
