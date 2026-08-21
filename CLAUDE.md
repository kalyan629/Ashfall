# ASHFALL — Claude Code Operating Instructions

## Read this first, every session

1. **PROJECT_MAP.md** — what is true right now. Short on purpose. Read it fully.
2. **This file** — behavioural rules.
3. **AI_MEMORY.md** — dated history. Read the INDEX, then only the entries needed.
   It is an archive, not a briefing.

Do not duplicate content across the three. Current state goes in PROJECT_MAP
(rewritten in place); events and decisions go in AI_MEMORY (appended, never
deleted — mark superseded blocks `SUPERSEDED — see <date>` in place).

## Context

Solo project by Kalyan, a Lead Data Engineer. He is strong on distributed state,
pipelines, and databases, and new to game development. Explain game-specific
concepts (rendering, game feel, netcode idioms) when they come up; do not explain
event sourcing, sharding, or SQL to him.

This is a **learning-forward** project with no deadline. Prefer the approach that
teaches the real concept over the shortcut that hides it — but never at the cost
of shipping something playable each phase.

## Hard boundaries

- **Never touch `C:\Users\kalya\OneDrive\Desktop\project workspace`** or anything
  under it. That is the research work (election-backend and friends). Different
  project, different rules, shared team branch.
- **This repo lives outside OneDrive on purpose.** Do not move it back in.
- **Local Python is blocked** by Windows Application Control (error 4551). Do not
  attempt local Python. Route Python work to Kipchoge.

## Kipchoge

`ssh kalyanb@kipchoge.ucd.ie` (VPN `gate.ucd.ie` when off-campus). Works from
this session.

- Role for this project: **asset generation, CI, load testing, VPN-only
  playtests.** Not a public game host — it is VPN-gated and it is a shared
  research server.
- Read freely. Before anything that WRITES or changes state, say what you are
  about to run and why.
- **Never edit files directly on Kipchoge.** Edit locally, then scp or git, then
  verify. Hand-editing on the server has caused syntax-error outages before.
- The existing `/homekipchoge/kalyanb/interior` pipeline is the asset foundry
  seed. Reuse its `env.sh` pattern: redirect every cache into the project root,
  and guard venv activation with `if` (not `[ ] && ...`, which returns 1 and
  kills `set -e` callers).
- Do not run GPU jobs without checking `nvidia-smi` first — the GPUs are shared.

## Engineering rules

- **The server is authoritative. Never trust the client.** Any state change a
  client can request must be validated server-side. This is not optional and not
  a later concern — retrofitting it is a rewrite.
- **`packages/shared` is the contract.** Protocol types live there and are
  imported by both sides. A field added on one side only is a bug.
- **Fixed timestep on the server.** Simulation must not depend on frame rate.
- **Every phase ends playable.** No phase is "done" until it can be demoed in a
  browser. Prefer a working ugly thing over a beautiful unfinished one.
- Prefer boring, readable TypeScript. This codebase is read months later by one
  person who was learning while writing it.

## Git

- Every phase is a branch, merged when its slice is playable.
- Never `git add -A` without showing the diff first.
- No credentials, tokens, or deploy keys in the repo or on Kipchoge.
