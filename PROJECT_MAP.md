# PROJECT_MAP — what is true right now

> Rewritten in place. Read this first, every session. Short on purpose.
> History and dated events go in `AI_MEMORY.md`, never here.

**Last updated:** 2026-08-21
**Phase:** 4 (asset foundry) running · Phase 0 (foundation) not started
**Status:** foundry live on Kipchoge, first full material batch generating

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

## The foundry (Phase 4) — live

- **Lives at** `/homekipchoge/kalyanb/ashfall-foundry` on Kipchoge. Scripts are
  version-controlled in `tools/foundry/` here and shipped up by scp —
  **never hand-edited on the server.**
- **tmux session `ashfall`.** His pre-existing `taip` session is not touched.
- **`bash teardown.sh`** removes the whole thing and the machine is back to
  normal. Refuses any FOUNDRY_ROOT not ending in `/ashfall-foundry`.
- **Downloads nothing.** Reuses `interior`'s HF cache read-only — SDXL base,
  the fp16 VAE fix, depth ControlNet and Depth-Anything are all already there.
- Venv built with **uv**, not `python3 -m venv` — the system python has no
  ensurepip and there is no sudo on that box.

### Foundry gotchas, each one learned the hard way

1. **CLIP truncates at 77 tokens silently.** Applies to negatives too. Per-material
   negatives go first so the targeted term survives. `tile.py` warns per-slug.
2. **Never use the word "flat".** Means flat *lighting* to a human, flat *design*
   to SDXL. It returned vector art.
3. **No palette tint in albedo maps.** Tint the scene with lights, not textures.
4. **Load SDXL from the local snapshot path, not the repo id.** The cached
   snapshot is incomplete against its own `model_index.json` (`vae` vs `vae_1_0`),
   so diffusers calls the whole model uncached.
5. **`HF_HUB_CACHE`, not `HUGGINGFACE_HUB_CACHE`.** huggingface_hub 1.x ignores
   the old one and silently uses the default path.
6. **Attention + VAE slicing** took generation from 8.4 s/step to 3.0 s/step on
   an 11 GB card.

## Blocked / open

- No git remote yet — decide public vs private before first push. `gh` CLI is
  **not installed locally**, so Claude cannot see or create GitHub repos yet.
- Public hosting target undecided; deliberately deferred.
- Several materials still need per-slug prompt tuning after the first batch.

## Next action

Phase 0: two browser tabs, two avatars, moving in real time on one
authoritative server. Runs locally, in parallel with the foundry.
