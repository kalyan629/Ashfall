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

if [ ! -d "$FOUNDRY_ROOT/venv" ]; then
  echo "Creating venv..."
  python3 -m venv "$FOUNDRY_ROOT/venv"
fi
. "$FOUNDRY_ROOT/venv/bin/activate"

python -m pip install --upgrade pip -q

echo "Installing pinned deps (from interior's pip cache where possible)..."
pip install -q \
  --extra-index-url https://download.pytorch.org/whl/cu121 \
  "torch==2.5.1+cu121" \
  "torchvision==0.20.1+cu121"

pip install -q \
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
