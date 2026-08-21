"""
Turn flat albedo textures into a real PBR material set.

    python pbr.py

Reads out/materials/<slug>/ (the best variant, by seam score) and writes
out/pbr/<slug>_{albedo,normal,ao}.webp plus a materials.json carrying the
scalar roughness/metalness for each.

WHY A DEPTH MODEL AND NOT ALBEDO LUMINANCE
------------------------------------------
The common trick is to treat albedo brightness as height and Sobel it into a
normal map. That is wrong wherever darkness is PIGMENT rather than DEPTH, and
this material set is full of exactly that case: `signage_painted` is hazard
yellow stencilled onto flat metal, `custody_panel` is a painted serial number,
`enamel_paint` is mismatched repaint. Luminance-derived normals emboss all of
that as physical grooves — the paint appears carved into the steel.

Depth-Anything-V2 is already in the interior project's HF cache (it came with
the ControlNet pipeline), so a real monocular depth estimate costs nothing
extra and gets the pigment-vs-depth distinction right.

AO IS BAKED, NOT SCREEN-SPACE
-----------------------------
SSAO on a GTX 1650 at 1080p is a meaningful frame cost, and we generate our own
textures anyway. Baking cavity occlusion from the height map is close to free
at runtime and gets most of the corner darkening. Screen-space AO can be added
later for contact shadows between OBJECTS, which a texture cannot provide.
"""

import json
import os
import re

import numpy as np
import torch
from PIL import Image

ROOT = os.environ.get("FOUNDRY_ROOT", "/homekipchoge/kalyanb/ashfall-foundry")
SRC = os.path.join(ROOT, "out", "materials")
DST = os.path.join(ROOT, "out", "pbr")
HERE = os.path.dirname(os.path.abspath(__file__))

SEAM_RE = re.compile(r"_v(\d+)_seam([0-9.]+)\.png$")
SIZE = 1024
QUALITY = 88


def best_variant(slug_dir):
    """Lowest seam score wins, same rule pack.py uses."""
    best = None
    for fn in os.listdir(slug_dir):
        m = SEAM_RE.search(fn)
        if not m:
            continue
        seam = float(m.group(2))
        if best is None or seam < best[0]:
            best = (seam, fn)
    return best


def load_depth_model():
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    name = "depth-anything/Depth-Anything-V2-Small-hf"
    proc = AutoImageProcessor.from_pretrained(name)
    model = AutoModelForDepthEstimation.from_pretrained(name).to("cuda").eval()
    return proc, model


@torch.no_grad()
def height_from(img, proc, model):
    """Monocular depth -> normalised height in [0,1]."""
    inputs = proc(images=img, return_tensors="pt").to("cuda")
    depth = model(**inputs).predicted_depth[0]
    depth = torch.nn.functional.interpolate(
        depth[None, None], size=(SIZE, SIZE), mode="bicubic", align_corners=False
    )[0, 0]
    d = depth.float().cpu().numpy()
    d = (d - d.min()) / max(d.max() - d.min(), 1e-6)
    return d


def normal_from_height(h, strength=2.2):
    """Sobel gradients -> tangent-space normal map.

    Wrapped with np.roll rather than edge-padded: these textures are tileable
    and an edge-clamped gradient would put a visible seam back into the normal
    map that the albedo does not have.
    """
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    gy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5

    nx = -gx * strength
    ny = -gy * strength
    nz = np.ones_like(h)

    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / length, ny / length, nz / length

    # Pack [-1,1] -> [0,255]. Three.js expects +Y up (OpenGL convention).
    out = np.stack([(nx + 1) * 0.5, (ny + 1) * 0.5, (nz + 1) * 0.5], axis=-1)
    return Image.fromarray((out * 255).astype(np.uint8), "RGB")


def ao_from_height(h, radius=6, strength=1.15):
    """Cavity occlusion: how far below its local average is this pixel?

    Cheap approximation of ambient occlusion. Points sitting in a dip get
    darkened; ridges stay bright. Blurred with a box filter via cumulative
    sums so it stays fast at 1024x1024.
    """
    pad = np.pad(h, radius, mode="wrap")
    cs = pad.cumsum(0).cumsum(1)
    cs = np.pad(cs, 1, mode="constant")
    k = radius * 2
    local = (
        cs[k:, k:] - cs[:-k, k:] - cs[k:, :-k] + cs[:-k, :-k]
    ) / (k * k)
    local = local[: h.shape[0], : h.shape[1]]

    cavity = np.clip((h - local) * strength + 1.0, 0.0, 1.0)
    # Never fully black: an AO map that reaches 0 kills all light in creases
    # and reads as dirt rather than shadow.
    cavity = 0.35 + 0.65 * cavity
    return Image.fromarray((cavity * 255).astype(np.uint8), "L").convert("RGB")


def main():
    with open(os.path.join(HERE, "prompts_materials.json"), encoding="utf-8") as f:
        manifest = json.load(f)

    props = {m["slug"]: m for m in manifest["materials"]}

    os.makedirs(DST, exist_ok=True)
    print("loading Depth-Anything-V2 ...")
    proc, model = load_depth_model()

    out_manifest = {}
    for slug in sorted(os.listdir(SRC)):
        d = os.path.join(SRC, slug)
        if not os.path.isdir(d):
            continue
        best = best_variant(d)
        if not best:
            continue
        seam, fn = best

        img = Image.open(os.path.join(d, fn)).convert("RGB")
        if img.size != (SIZE, SIZE):
            img = img.resize((SIZE, SIZE), Image.LANCZOS)

        h = height_from(img, proc, model)
        normal = normal_from_height(h)
        ao = ao_from_height(h)

        img.save(os.path.join(DST, f"{slug}_albedo.webp"), "WEBP", quality=QUALITY, method=6)
        normal.save(os.path.join(DST, f"{slug}_normal.webp"), "WEBP", quality=QUALITY, method=6)
        ao.save(os.path.join(DST, f"{slug}_ao.webp"), "WEBP", quality=QUALITY, method=6)

        spec = props.get(slug, {})
        out_manifest[slug] = {
            "seam": seam,
            # Scalars come from the MANIFEST, never from keyword-sniffing the
            # slug. `black_water` is glossy, `wet_limestone` semi-gloss and
            # `mud_silt` matte, and no shared substring distinguishes them.
            "roughness": spec.get("roughness", 0.85),
            "metalness": spec.get("metalness", 0.0),
            "normalScale": spec.get("normalScale", 1.0),
        }
        print(f"  {slug:20s} seam={seam:<6} rough={out_manifest[slug]['roughness']:<5} "
              f"metal={out_manifest[slug]['metalness']}")

    with open(os.path.join(DST, "materials.json"), "w") as f:
        json.dump(out_manifest, f, indent=2, sort_keys=True)

    total = sum(
        os.path.getsize(os.path.join(DST, f)) for f in os.listdir(DST) if f.endswith(".webp")
    )
    print(f"\n{len(out_manifest)} materials x 3 maps -> {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
