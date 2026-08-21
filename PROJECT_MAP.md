# PROJECT_MAP — what is true right now

> Rewritten in place. Read this first, every session. Short on purpose.
> History and dated events go in `AI_MEMORY.md`, never here.

**Last updated:** 2026-08-21
**Phase:** 0 — Foundation
**Status:** repo scaffolded, no code yet

---

## Paths

| What | Where |
|---|---|
| Repo (local, authoritative) | `C:\dev\ashfall` — **outside OneDrive, deliberately** |
| Remote | not yet created |
| Asset foundry (Kipchoge) | `/homekipchoge/kalyanb/interior` — existing 4-GPU SD pipeline, to be reused |
| NOT this project | `C:\Users\kalya\OneDrive\Desktop\project workspace` — research work, do not touch |

## Environments

1. **LOCAL** — Windows 11, Node 24.17, npm 11.13, git 2.54. Where dev happens.
   Local Python is blocked by Windows Application Control; do not attempt it.
2. **KIPCHOGE** — `ssh kalyanb@kipchoge.ucd.ie` (VPN `gate.ucd.ie` off-campus).
   72 cores, 503 GB RAM, 4× GTX 1080 Ti, 42 TB.
   Role: asset generation, CI, load testing, VPN-only playtests.
   **Not a public game host** — VPN-gated, and it is a shared research server.

## Stack

- **Language:** TypeScript, everywhere.
- **Client:** Three.js in the browser. Players join by URL, no install.
- **Server:** single portable Node process, authoritative, fixed 20 Hz tick.
- **Shared:** `packages/shared` holds the wire protocol used by both sides.

## Layout

```
packages/shared/   protocol types, constants — imported by both sides
packages/server/   authoritative simulation
packages/client/   Three.js renderer, input, prediction
docs/              design notes
```

## Blocked / open

- No git remote yet — decide public vs private before first push.
- Game not yet named (`ashfall` is a codename).
- Public hosting target undecided; deliberately deferred.

## Next action

Phase 0: two browser tabs, two avatars, moving in real time on one
authoritative server.
