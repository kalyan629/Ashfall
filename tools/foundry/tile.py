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

    vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        BASE, vae=vae, torch_dtype=torch.float16, variant="fp16", use_safetensors=True
    ).to("cuda")
    pipe.set_progress_bar_config(disable=True)

    n = make_tileable(pipe.unet, pipe.vae)
    print(f"[rank {args.rank}] circular padding applied to {n} conv layers", flush=True)

    os.makedirs(OUT, exist_ok=True)
    timing = {"rank": args.rank, "world": args.world, "items": []}
    t_all = time.time()

    for mat in mine:
        slug, zone = mat["slug"], mat["zone"]
        prompt = f"{mat['prompt']}, {zone_style[zone]}"
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
                negative_prompt=negative,
                width=SIZE, height=SIZE,
                num_inference_steps=args.steps,
                guidance_scale=6.5,
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
