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
#
# 🔴 WHAT REVIEW OF THIS SCRIPT FOUND, recorded because it is the reason
# `--self-test` exists at all. The mutation that first "proved" this
# guard — turning `incremental` back on — was measured on a working copy
# whose apps/api/node_modules was a MAJOR behind package-lock.json:
# @nestjs/cli 10.4.9 against a locked 12.0.5, typescript 5.7.2 against
# 6.0.3. On the tree `npm ci` actually installs, and therefore on CI, the
# emptying does NOT reproduce: both passes emit all 33 files and exit 0.
#
# So the guard was green on the very failure it was written for, and
# nothing said so. A guard that has never been seen to fail is a claim,
# not a guard. `--self-test` below is the rehearsal that makes it one: it
# exercises the ASSERTION rather than the compiler, so it keeps its
# meaning whatever Nest CLI does next.
set -euo pipefail

# The single assertion, kept apart from the build so the rehearsal can
# aim it at a directory we control.
assert_emitted() {
  local dist="$1" label="$2"

  if [ ! -f "$dist/main.js" ]; then
    echo "✗ $label: the build exited 0 but $dist/main.js does not exist."
    echo "  Almost certainly tsconfig.build.json has incremental back on"
    echo "  while nest-cli.json still deletes the output directory."
    return 1
  fi

  echo "✓ $label: main.js present ($(wc -c < "$dist/main.js") bytes)"
  return 0
}

# Prove the assertion can fail. Nothing here compiles anything.
#
# 🔴 No clocks. The first draft of this rehearsal compared mtimes to
# catch a stale artefact, and the rehearsal caught ITSELF: bash's `-nt`
# compares whole seconds on this host, so a file written in the same
# second as its marker reads as "not newer" and the check failed on a
# genuinely fresh build. `stat` also spells its flags differently on
# macOS and on the Linux CI runs on. Deleting main.js before each pass
# removes the whole question — after that, presence IS emission, and the
# stale-artefact hole closes with it.
self_test() {
  local tmp rc=0
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/empty" "$tmp/full"
  : > "$tmp/full/main.js"

  if assert_emitted "$tmp/empty" "rehearsal" >/dev/null 2>&1; then
    echo "✗ REHEARSAL FAILED: the check passed on a dist with no main.js."
    echo "  This guard cannot see the failure it exists for."
    rc=1
  fi

  # And the other direction, so the rehearsal cannot be satisfied by an
  # assertion that simply always fails.
  if ! assert_emitted "$tmp/full" "rehearsal" >/dev/null 2>&1; then
    echo "✗ REHEARSAL FAILED: the check rejected a dist that holds main.js."
    rc=1
  fi

  rm -rf "$tmp"
  if [ "$rc" -eq 0 ]; then
    echo "✓ rehearsal: the check fails on an empty dist and passes on a full one."
  fi
  return "$rc"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

cd "$(dirname "$0")/../../apps/api"

for pass in 1 2; do
  # 🔴 Remove it first, and this is the whole design. Review found that
  # checking only for presence lets a build which fails AFTER dist is
  # populated report success on yesterday's file — a deliberate type
  # error left a stale main.js on disk and the check was happy. With the
  # file deleted beforehand, its presence afterwards can only mean this
  # pass wrote it. `deleteOutDir` already empties the directory, so this
  # takes nothing the build was going to keep.
  rm -f dist/main.js
  npx nest build
  assert_emitted dist "pass $pass"
done
