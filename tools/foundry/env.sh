# ASHFALL asset foundry — environment
#
# Pattern lifted verbatim from ~/interior/env.sh, which is proven:
# every cache is redirected inside FOUNDRY_ROOT so nothing lands in the shared
# home, and venv activation is guarded with `if` rather than `[ ] && ...` --
# the latter returns 1 when the venv is absent, which kills any caller running
# under `set -e` at the source line.
#
# Everything this project writes lives under FOUNDRY_ROOT. teardown.sh removes
# that one directory and the machine is back to normal.

export FOUNDRY_ROOT="${FOUNDRY_ROOT:-/homekipchoge/kalyanb/ashfall-foundry}"

# Reuse the interior project's model cache READ-ONLY. SDXL base, the fp16 VAE
# fix, controlnet-depth-sdxl-1.0 and Depth-Anything-V2-Small are all already
# downloaded there -- roughly 17 GB we do not need to fetch again.
# COUPLING: if ~/interior is ever deleted, set this to
# "$FOUNDRY_ROOT/models/hf/hub" and the models re-download.
export INTERIOR_HUB="/homekipchoge/kalyanb/interior/models/hf/hub"
export HUGGINGFACE_HUB_CACHE="$INTERIOR_HUB"
export HF_HOME="$FOUNDRY_ROOT/models/hf"

export TORCH_HOME="$FOUNDRY_ROOT/models/torch"
export XDG_CACHE_HOME="$FOUNDRY_ROOT/models/xdg"
export PIP_CACHE_DIR="/homekipchoge/kalyanb/interior/models/pipcache"
export MPLCONFIGDIR="$FOUNDRY_ROOT/models/mpl"
export TMPDIR="$FOUNDRY_ROOT/tmp"

export HF_HUB_DISABLE_TELEMETRY=1
export HF_HUB_OFFLINE=1          # models are local; never phone home mid-run
export TOKENIZERS_PARALLELISM=false
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

mkdir -p "$TMPDIR" "$FOUNDRY_ROOT/models" "$FOUNDRY_ROOT/out" "$FOUNDRY_ROOT/logs"

if [ -f "$FOUNDRY_ROOT/venv/bin/activate" ]; then
  . "$FOUNDRY_ROOT/venv/bin/activate"
fi
