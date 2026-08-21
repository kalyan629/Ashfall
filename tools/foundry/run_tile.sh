#!/usr/bin/env bash
# Launch the tileable-material run across all 4 GPUs.
#
# Each process is pinned to one GPU with CUDA_VISIBLE_DEVICES, so inside the
# process that GPU is always device 0. Jobs are sharded round-robin from the
# manifest, so the four processes never need to talk to each other.
#
# Usage:
#   bash run_tile.sh              # full run, all 4 GPUs
#   bash run_tile.sh --smoke      # rank 0 only, 2 materials, 1 variant

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

LOGS="$FOUNDRY_ROOT/logs"
mkdir -p "$LOGS"

if [ "${1:-}" = "--smoke" ]; then
  echo "SMOKE TEST: rank 0 only, 2 materials, 1 variant each."
  CUDA_VISIBLE_DEVICES=0 python "$HERE/tile.py" \
    --rank 0 --world 1 --limit 2 --variants 1 --steps 28 \
    2>&1 | tee "$LOGS/smoke.log"
  echo
  echo "Output:"
  find "$FOUNDRY_ROOT/out/materials" -name "*.png" | sed 's/^/  /'
  exit 0
fi

# Refuse to trample a run that is already going.
if pgrep -f "[t]ile.py --rank" >/dev/null 2>&1; then
  echo "REFUSING: a tile.py run is already in progress." >&2
  echo "Check with: ps -ef | grep '[t]ile.py'" >&2
  exit 1
fi

echo "Launching 4 ranks..."
for i in 0 1 2 3; do
  CUDA_VISIBLE_DEVICES=$i nohup python "$HERE/tile.py" \
    --rank "$i" --world 4 \
    > "$LOGS/tile_rank$i.log" 2>&1 &
  echo "  rank $i -> GPU $i  (pid $!)"
done

wait
echo "All ranks finished."
