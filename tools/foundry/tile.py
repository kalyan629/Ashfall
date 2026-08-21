"""
Generate seamless tileable material textures for ASHFALL.

SDXL base + the fp16 VAE fix, both already on disk in the interior project's
HF cache, so this runs fully offline.

The seamless trick
------------------
A normal conv pads its input with zeros at the edges, so the model has no idea
the left edge should continue into the right edge -- you get a visible seam when
you tile the result. Switching every Conv2d to `padding_mode="circular"` makes
the padding wrap around instead, so the model literally cannot tell where the
edge is and generates something that meets itself. It is a two-line change and
it is the whole technique.

Sharding
--------
Same pattern as interior/scripts/generate.py: one process per GPU, jobs handed
out round-robin by index, no coordination between processes at all.

    for i in 0 1 2 3; do
      python tile.py --rank $i --world 4 &
    done

Usage
-----
    python tile.py --rank 0 --world 1 --limit 2      # smoke test
    python tile.py --rank 0 --world 4                # full shard
"""

import argparse
import json
import os
import time

import numpy as np
import torch
from PIL import Image

ROOT = os.environ.get("FOUNDRY_ROOT", "/homekipchoge/kalyanb/ashfall-foundry")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out", "materials")

BASE = "stabilityai/stable-diffusion-xl-base-1.0"
VAE = "madebyollin/sdxl-vae-fp16-fix"

# 1024 is SDXL's native square bucket. Materials are square by definition, and
# going off-bucket on SDXL costs quality for no benefit here.
SIZE = 1024


def local_snapshot(repo_id):
    """Resolve a repo id to its on-disk snapshot directory.

    We load from the directory rather than the repo id on purpose. The cached
    SDXL snapshot is *incomplete relative to its own model_index.json* -- the
    index declares a `vae` component but only `vae_1_0/` was ever fetched. Given
    a repo id, diffusers runs its download step first, notices the gap, and
    reports the whole model as uncached even though every file we actually use
    is present. Handing it a local path skips that check entirely, and the
    missing folder never matters because we pass our own VAE in.
    """
    import glob

    cache = os.environ.get("HF_HUB_CACHE") or os.environ.get("HUGGINGFACE_HUB_CACHE")
    if not cache:
        return repo_id  # let diffusers do its normal thing

    stem = "models--" + repo_id.replace("/", "--")
    snaps = sorted(glob.glob(os.path.join(cache, stem, "snapshots", "*")))
    if not snaps:
        raise SystemExit(f"No cached snapshot for {repo_id} under {cache}")
    return snaps[-1]


def make_tileable(*modules):
    """Switch every Conv2d in the given modules to circular padding.

    Must be applied to the UNet *and* the VAE decoder -- patching only the UNet
    leaves the decoder free to reintroduce a seam on the way back to pixels.
    """
    patched = 0
    for m in modules:
        for sub in m.modules():
            if isinstance(sub, torch.nn.Conv2d):
                sub.padding_mode = "circular"
                patched += 1
    return patched


def seam_error(img):
    """How badly does this image fail to tile? Lower is better.

    Compares the wrap-around edges against their immediate neighbours. A truly
    seamless texture has roughly the same difference across the wrap as it does
    anywhere else in the image, so the ratio lands near 1.0. A hard seam pushes
    it well above that.
    """
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    wrap_h = np.abs(a[:, -1, :] - a[:, 0, :]).mean()
    wrap_v = np.abs(a[-1, :, :] - a[0, :, :]).mean()
    interior_h = np.abs(a[:, 1:, :] - a[:, :-1, :]).mean()
    interior_v = np.abs(a[1:, :, :] - a[:-1, :, :]).mean()
    return round(float((wrap_h + wrap_v) / (interior_h + interior_v + 1e-6)), 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rank", type=int, default=0)
    ap.add_argument("--world", type=int, default=1)
    ap.add_argument("--variants", type=int, default=3, help="images per material")
    ap.add_argument("--steps", type=int, default=32)
    ap.add_argument("--limit", type=int, default=0, help="0 = no limit; smoke test uses 2")
    ap.add_argument("--seed", type=int, default=20260821)
    ap.add_argument("--guidance", type=float, default=5.5,
                    help="lower keeps it photographic; high pushes it stylised")
    ap.add_argument("--dtype", choices=["fp16", "fp32"], default="fp16",
                    help="1080 Ti is Pascal, whose fp16 rate is 1/64 of fp32 -- "
                         "fp32 can be FASTER here despite the memory cost")
    ap.add_argument("--offload", action="store_true",
                    help="sequential CPU offload; needed to fit fp32 in 11 GB")
    ap.add_argument("--manifest", default=os.path.join(HERE, "prompts_materials.json"))
    args = ap.parse_args()

    with open(args.manifest, encoding="utf-8") as f:
        man = json.load(f)

    negative = man["shared_negative"]
    zone_style = man["zone_style"]
    materials = man["materials"]

    # Round-robin shard. Deterministic, and every process computes it the same
    # way from the same manifest, so no process needs to talk to any other.
    mine = [m for i, m in enumerate(materials) if i % args.world == args.rank]
    if args.limit:
        mine = mine[: args.limit]

    print(f"[rank {args.rank}/{args.world}] {len(mine)} materials, "
          f"{args.variants} variants each = {len(mine) * args.variants} images",
          flush=True)

    from diffusers import AutoencoderKL, StableDiffusionXLPipeline

    torch.cuda.set_device(0)  # each process sees one GPU via CUDA_VISIBLE_DEVICES

    base_dir, vae_dir = local_snapshot(BASE), local_snapshot(VAE)
    dtype = torch.float16 if args.dtype == "fp16" else torch.float32
    print(f"[rank {args.rank}] base={base_dir} dtype={args.dtype}", flush=True)

    # The weights on disk are the fp16 variant either way; torch_dtype decides
    # what they are upcast to in memory.
    vae = AutoencoderKL.from_pretrained(vae_dir, torch_dtype=dtype)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        base_dir, vae=vae, torch_dtype=dtype,
        variant="fp16", use_safetensors=True,
    )
    if args.offload:
        pipe.enable_sequential_cpu_offload()
    else:
        pipe = pipe.to("cuda")
    pipe.enable_attention_slicing()
    pipe.enable_vae_slicing()
    pipe.set_progress_bar_config(disable=True)

    n = make_tileable(pipe.unet, pipe.vae)
    print(f"[rank {args.rank}] circular padding applied to {n} conv layers", flush=True)

    # Token budget check. CLIP silently truncates at 77 and returns no error,
    # so an over-budget prompt looks like it worked and simply ignores its own
    # tail. Fail loudly here instead of discovering it in the output.
    tok = pipe.tokenizer
    over = []
    for mat in mine:
        p = f"{zone_style[mat['zone']]}, {mat['prompt']}"
        n = len(tok(p).input_ids)
        if n > tok.model_max_length:
            over.append((mat["slug"], n))
    if over:
        print(f"[rank {args.rank}] WARNING: {len(over)} prompts exceed "
              f"{tok.model_max_length} tokens and WILL be truncated:", flush=True)
        for slug, n in over:
            print(f"    {slug}: {n} tokens", flush=True)
    else:
        print(f"[rank {args.rank}] all prompts within the "
              f"{tok.model_max_length}-token budget", flush=True)

    os.makedirs(OUT, exist_ok=True)
    timing = {"rank": args.rank, "world": args.world, "items": []}
    t_all = time.time()

    for mat in mine:
        slug, zone = mat["slug"], mat["zone"]
        # Zone style FIRST. CLIP truncates at 77 tokens and drops the tail, so
        # anything at the end is the thing that silently vanishes. The lighting
        # clause ("no shadows, flat even light, albedo") has to survive, so it
        # leads; the material description is what gets clipped if anything does.
        prompt = f"{zone_style[zone]}, {mat['prompt']}"
        # Per-material negatives exist because some slugs drift to a nearby
        # archetype -- shotcrete becomes brickwork, rock face becomes paving.
        neg = f"{negative}, {mat['negative']}" if mat.get("negative") else negative
        d = os.path.join(OUT, slug)
        os.makedirs(d, exist_ok=True)

        t0 = time.time()
        for v in range(args.variants):
            # Seed derived from slug so a rerun reproduces the same image, and
            # so two materials never accidentally share a seed.
            seed = args.seed + (abs(hash(slug)) % 100000) + v
            g = torch.Generator("cuda").manual_seed(seed)
            img = pipe(
                prompt=prompt,
                negative_prompt=neg,
                width=SIZE, height=SIZE,
                num_inference_steps=args.steps,
                guidance_scale=args.guidance,
                generator=g,
            ).images[0]

            err = seam_error(img)
            path = os.path.join(d, f"{slug}_v{v}_seam{err}.png")
            img.save(path)
            print(f"[rank {args.rank}] {slug} v{v}  seam={err}  -> {path}", flush=True)

        dt = round(time.time() - t0, 1)
        timing["items"].append({"slug": slug, "seconds": dt})

    timing["total_seconds"] = round(time.time() - t_all, 1)
    with open(os.path.join(ROOT, "out", f"timing_tile_rank{args.rank}.json"), "w") as f:
        json.dump(timing, f, indent=2)

    print(f"[rank {args.rank}] done in {timing['total_seconds']}s", flush=True)


if __name__ == "__main__":
    main()
