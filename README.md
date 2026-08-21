# ASHFALL

An apocalyptic survival game with a **persistent shared bunker**.

Humanity is believed to have been devastated by an unknown catastrophe. Millions
of survivors live inside enormous underground shelters. The outside world is
dangerous, mysterious, and largely unexplored.

The point of the game is that the bunker is **real and shared** — other players
in it are other people, right now. You survive together: power, water, food,
crafting, and expeditions to the surface. The surface is procedurally generated
and it can kill you.

Runs in the browser. Players join by clicking a URL — no install.

## Stack

| Layer | Tech |
|---|---|
| Client | TypeScript · Three.js |
| Server | TypeScript · Node · authoritative, 20 Hz fixed tick |
| Shared | wire protocol types imported by both sides |

## Layout

```
packages/shared/   protocol types + constants, imported by client AND server
packages/server/   authoritative simulation — the source of truth
packages/client/   renderer, input, client-side prediction
docs/              design notes
```

## Running

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` in two browser tabs.

## Documents

- **[PROJECT_MAP.md](PROJECT_MAP.md)** — what is true right now. Read first.
- **[ROADMAP.md](ROADMAP.md)** — phases, decisions of record, glossary.
- **[AI_MEMORY.md](AI_MEMORY.md)** — dated, append-only history.

## Status

Phase 0 — Foundation. Scaffolded 2026-08-21.
