"""
Pack generated materials into game-ready textures.

The foundry produces three variants of every material as ~2 MB PNGs. Thirty
materials of that is ~60 MB, which is fine on disk and completely unshippable
over a network — the client would spend its first minute downloading floor.

This step does three things:
  1. Picks the best variant per material, by the seam score tile.py recorded
     in each filename. Lower is better; 1.0 means the wrap-around edges differ
     no more than the interior does, which is what seamless actually means.
  2. Converts to WebP. Roughly 10x smaller than PNG at a quality nobody can
     tell apart on a rough surface under a moving light.
  3. Writes a manifest so the client knows what exists without guessing.

Usage:  python pack.py [--quality 85] [--size 1024]
"""

import argparse
import json
import os
import re
import shutil

from PIL import Image

ROOT = os.environ.get("FOUNDRY_ROOT", "/homekipchoge/kalyanb/ashfall-foundry")
SRC = os.path.join(ROOT, "out", "materials")
DST = os.path.join(ROOT, "out", "pack")

# Filenames look like: shotcrete_v1_seam0.976.png
SEAM_RE = re.compile(r"_v(\d+)_seam([0-9.]+)\.png$")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--size", type=int, default=1024)
    # Anything above this is visibly seamed and should be regenerated rather
    # than shipped. Reported, not silently dropped -- a missing texture is a
    # worse failure than a slightly seamed one.
    ap.add_argument("--seam-warn", type=float, default=1.08)
    args = ap.parse_args()

    if os.path.isdir(DST):
        shutil.rmtree(DST)
    os.makedirs(DST, exist_ok=True)

    manifest = {}
    flagged = []
    total_src = 0
    total_dst = 0

    for slug in sorted(os.listdir(SRC)):
        d = os.path.join(SRC, slug)
        if not os.path.isdir(d):
            continue

        best = None
        for fn in os.listdir(d):
            m = SEAM_RE.search(fn)
            if not m:
                continue
            seam = float(m.group(2))
            if best is None or seam < best[0]:
                best = (seam, fn)

        if best is None:
            print(f"  !! {slug}: no usable variant")
            continue

        seam, fn = best
        src = os.path.join(d, fn)
        out = os.path.join(DST, f"{slug}.webp")

        img = Image.open(src).convert("RGB")
        if img.size != (args.size, args.size):
            img = img.resize((args.size, args.size), Image.LANCZOS)
        img.save(out, "WEBP", quality=args.quality, method=6)

        s_src = os.path.getsize(src)
        s_dst = os.path.getsize(out)
        total_src += s_src
        total_dst += s_dst

        manifest[slug] = {"seam": seam, "variant": fn, "bytes": s_dst}
        mark = "  <-- SEAMED" if seam > args.seam_warn else ""
        if seam > args.seam_warn:
            flagged.append((slug, seam))
        print(f"  {slug:20s} seam={seam:<6} {s_src // 1024:>5} KB -> {s_dst // 1024:>4} KB{mark}")

    with open(os.path.join(DST, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)

    print()
    print(f"{len(manifest)} materials packed")
    print(f"{total_src / 1e6:.1f} MB PNG -> {total_dst / 1e6:.1f} MB WebP "
          f"({total_src / max(total_dst, 1):.1f}x smaller)")
    if flagged:
        print(f"\n{len(flagged)} need regeneration (seam > {args.seam_warn}):")
        for slug, seam in sorted(flagged, key=lambda x: -x[1]):
            print(f"  {slug}  {seam}")


if __name__ == "__main__":
    main()
