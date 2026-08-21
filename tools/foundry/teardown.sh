#!/usr/bin/env bash
# ASHFALL asset foundry — teardown.
#
# One command, everything gone, machine back to normal. This is a design
# requirement, not a convenience: the foundry is a guest on a shared research
# server and must leave no trace.
#
# What it does NOT touch, ever:
#   - ~/interior            (the source pipeline and its 17 GB model cache)
#   - ~/election-backend    (the research project)
#   - any tmux session other than "ashfall"
#
# Usage:  bash teardown.sh          # asks first
#         bash teardown.sh --force  # does not ask

set -euo pipefail

ROOT="${FOUNDRY_ROOT:-/homekipchoge/kalyanb/ashfall-foundry}"

# Refuse to run against anything that is not plausibly the foundry. A typo'd
# FOUNDRY_ROOT pointing at $HOME would otherwise be catastrophic.
case "$ROOT" in
  */ashfall-foundry) ;;
  *) echo "REFUSING: FOUNDRY_ROOT=$ROOT does not end in /ashfall-foundry" >&2
     exit 1 ;;
esac

if [ ! -d "$ROOT" ]; then
  echo "Nothing to remove: $ROOT does not exist."
  exit 0
fi

echo "About to remove:"
echo "  $ROOT   ($(du -sh "$ROOT" 2>/dev/null | cut -f1))"
echo
echo "Will NOT touch: ~/interior, ~/election-backend, tmux session 'taip'."
echo

if [ "${1:-}" != "--force" ]; then
  printf "Type YES to continue: "
  read -r reply
  [ "$reply" = "YES" ] || { echo "Aborted."; exit 1; }
fi

# Kill only our own tmux session, and only if it exists.
if tmux has-session -t ashfall 2>/dev/null; then
  tmux kill-session -t ashfall
  echo "Killed tmux session 'ashfall'."
fi

rm -rf "$ROOT"
echo "Removed $ROOT. Machine is back to normal."
