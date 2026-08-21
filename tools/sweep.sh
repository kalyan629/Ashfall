#!/usr/bin/env bash
# Parallel experiment sweep on Kipchoge.
#
#   bash tools/sweep.sh liar 48 32
#     experiment ^     seeds^  ^ranks
#
# The simulation is CPU work — branchy pointer-chasing over maps — so this uses
# CORES, not the GPUs. Kipchoge's 72 Xeon cores are the useful resource for
# experiments; the 1080 Tis earn their keep in the texture foundry instead.
#
# Same round-robin sharding as tools/foundry: each rank computes its own slice
# from (seed % world == rank), so no rank ever talks to another.

set -euo pipefail

EXP="${1:-liar}"
SEEDS="${2:-48}"
RANKS="${3:-32}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$HERE/results/$EXP-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

echo "sweep: $EXP  seeds=$SEEDS  ranks=$RANKS"
echo "out:   $OUT"
echo

cd "$HERE/packages/sim"

pids=()
for ((i = 0; i < RANKS; i++)); do
  node --import tsx "experiments/$EXP.ts" \
    --rank "$i" --world "$RANKS" --seeds "$SEEDS" \
    > "$OUT/rank$i.json" 2> "$OUT/rank$i.err" &
  pids+=($!)
done

echo "launched ${#pids[@]} ranks; waiting..."
fail=0
for pid in "${pids[@]}"; do
  wait "$pid" || fail=$((fail + 1))
done

echo "done. $fail rank(s) failed."

# Merge. Ranks are independent, so concatenation is the whole join.
node -e '
const fs = require("fs"), path = require("path");
const dir = process.argv[1];
const all = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const raw = fs.readFileSync(path.join(dir, f), "utf8").trim();
  if (!raw) continue;
  try { all.push(...JSON.parse(raw)); }
  catch { console.error("unparseable:", f); }
}
fs.writeFileSync(path.join(dir, "merged.json"), JSON.stringify(all, null, 2));
console.log(`merged ${all.length} runs -> merged.json`);
' "$OUT"

echo "$OUT"
