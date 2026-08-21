# PROJECT_MAP — what is true right now

> Rewritten in place. Read this first, every session. Short on purpose.
> History and dated events go in `AI_MEMORY.md`, never here.

**Last updated:** 2026-08-21 (end of day 1)
**Phase:** 0 done · 4 done · **5 started**
**Status:** playable. Two rooms, real multiplayer, headlamp, 30 textures shipped.

---

## Paths

| What | Where |
|---|---|
| Repo (local, authoritative) | `C:\dev\ashfall` — **outside OneDrive, deliberately** |
| Remote | **https://github.com/kalyan629/Ashfall** (pushed) |
| Foundry (Kipchoge) | `/homekipchoge/kalyanb/ashfall-foundry` |
| Source diffusion pipeline | `/homekipchoge/kalyanb/interior` — reused read-only |
| NOT this project | `C:\Users\kalya\OneDrive\Desktop\project workspace` — research work, **never touch** |

## Run it

```bash
npm install
npm run start --workspace=@ashfall/server   # authoritative server on :8080
npm run dev   --workspace=@ashfall/client   # vite on :5173
node tools/netsmoke.mjs                     # 7/7 two-client integration test
node tools/peek.mjs                         # print live player positions
```

Open `http://localhost:5173/?name=you` in two tabs. **WASD** move · **F** headlamp ·
**H** cut/restore the air handlers.

## Layout

```
packages/shared/   protocol + world geometry + movement — imported by BOTH sides
packages/server/   authoritative simulation, 20 Hz fixed tick
packages/client/   Three.js renderer, prediction, headlamp, audio
packages/client/public/tex/   30 generated materials (WebP, 6.6 MB)
tools/foundry/     asset generation, shipped to Kipchoge by scp
docs/WORLD.md      story, systems, art direction — Phase 4 prompts come from 8.3
docs/shots/        screenshots
```

## What exists

- **Phase 0** — authoritative server, client prediction, server reconciliation,
  snapshot interpolation. `netsmoke` 7/7.
- **Phase 4 — DONE.** 90 images, 30 materials, all under the 1.08 seam
  threshold. Packed 59.1 MB PNG → 6.8 MB WebP (8.6x).
- **Phase 5 — started.** The drift east: a 2.6 m tunnel off the Commons, unlit.
  Headlamp with a 240 s charge that browns out below 20 s. Global fill and fog
  ease between zones. No fauna yet.

## Gotchas, each one learned the hard way

### Engine / architecture
1. **Change `shared/world.ts` → RESTART THE SERVER.** Vite hot-reloads the
   client but the server imports the shared package at boot. Symptom: you walk
   into a doorway that visibly exists and get blocked by the old geometry.
2. **Never infer a mesh's role from its dimensions.** `hz < 1 && hx > 2` meant
   "bench" and silently matched the perimeter walls, which rendered 0.8 m tall.
   Colliders now declare `kind` and `h`.
3. **Camera must stay under the ceiling.** 5 m in the Commons, 2.6 m in the
   drift, and the drift camera must stay on the tunnel centreline or the lens
   ends up inside rock.
4. **Warm light needs cold light.** Sodium-only went monochrome and grey tread
   floor read as orange brick. There is a cold hemisphere fill for contrast.
5. `hum.running` false ≠ hum stopped. WebAudio cannot start before a gesture;
   `Hum.started` distinguishes them.

### Foundry
6. **CLIP truncates at 77 tokens silently**, negatives too. Per-material
   negatives go first so the targeted term survives.
7. **Never use the word "flat"** — means flat *lighting* to a human, flat
   *design* to SDXL. It returned vector art.
8. **No palette tint in albedo.** Tint with lights, not textures. Verified:
   `steel_plate` is correctly neutral grey and only looks orange in-engine.
9. **Load SDXL from the local snapshot path, not the repo id.** The cached
   snapshot is incomplete against its own `model_index.json` (`vae` vs
   `vae_1_0`), so diffusers calls the whole model uncached.
10. **`HF_HUB_CACHE`, not `HUGGINGFACE_HUB_CACHE`** — huggingface_hub 1.x
    ignores the old name and silently uses the default path.
11. **uv, not `python3 -m venv`** on Kipchoge — no ensurepip, no sudo.

### Local environment
12. **Local Python works again via uv** (retested 2026-08-21). The old "App
    Control blocks every python.exe" rule applies only to the bare `python`
    PATH stub. `uv venv` / `uv run` / `uv pip install` all work.
13. **Playwright MCP writes to Claude Code's open folder.** `--output-dir` is
    pinned in `~/.claude.json`, but that only takes effect after a restart.

## MCP servers

Configured **globally** in `~/.claude.json` (project-scoped `.mcp.json` is only
read from the folder Claude Code has open, which is usually not this repo):

- `playwright` — screenshots and driving the game. Essential; four real bugs
  were found in the first ten minutes of being able to see the screen.
- `blender` — Blender 5.2 installed, addon in place. **Not yet exercised.**

## Blocked / open

- **Fauna not started.** Drift, Choir, Sow, the Long are designed in WORLD.md
  but nothing is implemented. Needs the Blender MCP path proven first.
- **No occlusion culling.** Three.js has none built in; a 60 km bunker cannot
  be one scene. Portal/sector visibility is the Phase 7 architecture and mine
  drifts are already portal-shaped.
- No normal maps — bump-from-albedo is a stand-in. Foundry needs a height pass.
- Public hosting target undecided, deliberately.

## Next action

Phase 5 proper: the first creature. Drift is the one to build — it hunts by
sound, and the hum-stops mechanic is already implemented for it to key off.
