#!/usr/bin/env bash
# ASHFALL asset foundry — one-time setup on Kipchoge.
#
# Creates an isolated venv under FOUNDRY_ROOT. Never the shared
# ~/election-backend/.venv, never ~/interior/venv.
#
# Versions are pinned to exactly what ~/interior/venv already runs, because
# that combination is known-good on these GPUs with this CUDA. The wheels are
# already in interior's pip cache, so this installs from cache and is fast.
#
# Usage:  bash setup.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

echo "FOUNDRY_ROOT = $FOUNDRY_ROOT"

# uv, not `python3 -m venv` -- the system python has no ensurepip and there is
# no sudo on this box. uv is also what built interior/venv, so this matches.
command -v uv >/dev/null || { echo "uv not found on PATH ($PATH)" >&2; exit 1; }

if [ ! -d "$FOUNDRY_ROOT/venv" ]; then
  echo "Creating venv with uv..."
  uv venv --python 3.12 "$FOUNDRY_ROOT/venv"
fi
. "$FOUNDRY_ROOT/venv/bin/activate"

echo "Installing pinned deps (uv, reusing interior's cache)..."
uv pip install -q \
  --extra-index-url https://download.pytorch.org/whl/cu121 \
  "torch==2.5.1+cu121" \
  "torchvision==0.20.1+cu121"

uv pip install -q \
  "diffusers==0.39.0" \
  "transformers==5.14.1" \
  "accelerate==1.14.0" \
  "safetensors==0.8.0" \
  "opencv-python-headless" \
  "pillow" \
  "numpy"

echo
echo "=== verify ==="
python - <<'PY'
import torch, diffusers, transformers
print(f"torch        {torch.__version__}")
print(f"diffusers    {diffusers.__version__}")
print(f"transformers {transformers.__version__}")
print(f"cuda         {torch.cuda.is_available()}  devices={torch.cuda.device_count()}")
for i in range(torch.cuda.device_count()):
    print(f"  [{i}] {torch.cuda.get_device_name(i)}")
PY

echo
echo "=== models visible offline ==="
ls "$INTERIOR_HUB" | sed 's/^/  /'
echo
echo "Setup complete."
