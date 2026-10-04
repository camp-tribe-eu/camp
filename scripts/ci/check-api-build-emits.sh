#!/usr/bin/env bash
# 🔴 Does `nest build` actually EMIT? Run it twice and look.
#
# CAMP-192. The failure this rehearses: with `incremental` on and
# `deleteOutDir: true`, the SECOND build wipes dist, decides from the
# .tsbuildinfo that there is nothing to do, and exits 0 having produced
# nothing. A build that exits 0 and writes no files is the worst shape a
# failure can take — every check downstream reads it as success.
#
# One build proves nothing: the first one emits even when broken. The bug
# only appears on the second, which is why this runs it twice.
set -euo pipefail
cd "$(dirname "$0")/../../apps/api"

for pass in 1 2; do
  npx nest build
  if [ ! -f dist/main.js ]; then
    echo "✗ pass $pass: nest build exited 0 but dist/main.js does not exist."
    echo "  Almost certainly tsconfig.build.json has incremental back on"
    echo "  while nest-cli.json still deletes the output directory."
    exit 1
  fi
  echo "✓ pass $pass: dist/main.js present ($(wc -c < dist/main.js) bytes)"
done
