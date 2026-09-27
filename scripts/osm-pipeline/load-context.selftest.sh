#!/usr/bin/env bash
# Self-test for load-context.sh — the download-and-verify half.
#
# 🔴 Why this file exists.
#
# load-context.sh had NO tests, and in two rounds of review it produced
# three separate ways to load an unverified extract while printing
# "✓ context layers ready":
#
#   1. the gate asked "is the file the expected size", and a resumed
#      splice is exactly the expected size;
#   2. the marker's fingerprint came from `stat -f` first, which on GNU
#      is --file-system: it prints "? ?" and exits 0, so every Linux
#      file fingerprinted identically;
#   3. a fingerprint that could not be read became the string `unknown`,
#      written into the marker and matched against itself next run.
#
# Every one of those survived shellcheck, code review and a full CI run.
# The only thing that catches them is driving the script with a broken
# world and asserting on what it does — which is what this does.
#
# 🔴 It never touches the network or a database. `curl`, `osmium`,
# `ogr2ogr` and `psql` are shimmed on PATH; `md5`/`md5sum` are NOT,
# because the checksum comparison is the thing under test.
#
#   ./scripts/osm-pipeline/load-context.selftest.sh

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/load-context.sh"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/load-context-selftest.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

FAILURES=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILURES=$((FAILURES + 1)); }

# ── the world the script runs in ────────────────────────────────────
#
# One fixture "extract": small, real bytes, with a real md5. Scenarios
# are chosen with SHIM_MODE, read by the curl shim at call time.
BIN="$ROOT/bin"
mkdir -p "$BIN"
GOOD="$ROOT/good.pbf"
head -c 4096 /dev/urandom > "$GOOD"
if command -v md5sum >/dev/null 2>&1; then
  GOOD_MD5=$(md5sum "$GOOD" | awk '{print $1}')
else
  GOOD_MD5=$(md5 -q "$GOOD")
fi

cat > "$BIN/curl" <<SHIM
#!/usr/bin/env bash
# Enough of curl to drive load-context.sh. Reads SHIM_MODE per call.
set -uo pipefail
args=("\$@"); out=''; url=''; head=0; resume=0
for ((i=0; i<\${#args[@]}; i++)); do
  case "\${args[i]}" in
    -o) out="\${args[i+1]}" ;;
    -I) head=1 ;;
    -C) resume=1 ;;
    http*|https*) url="\${args[i]}" ;;
  esac
done

region=\$(basename "\$url" | sed -E 's/-(latest|[0-9]{6})\.osm\.pbf(\.md5)?\$//')

if [ "\$head" = 1 ]; then
  case "\${SHIM_MODE:-ok}" in
    head-fails) exit 7 ;;
    redirect-to-index) printf 'HTTP/1.1 200 OK\r\ncontent-length: 512\r\n\r\n\n%s\n' 'https://example.invalid/' ;;
    redirect-other-region)
      printf 'HTTP/1.1 200 OK\r\ncontent-length: $(wc -c < "$GOOD")\r\n\r\n\n%s\n' \\
        "https://example.invalid/europe/elsewhere-260925.osm.pbf" ;;
    mirror)
      printf 'HTTP/1.1 200 OK\r\ncontent-length: $(wc -c < "$GOOD")\r\n\r\n\n%s\n' \\
        "https://mirror.invalid/pub/osm/\$region-latest.osm.pbf" ;;
    *) printf 'HTTP/1.1 200 OK\r\ncontent-length: $(wc -c < "$GOOD")\r\n\r\n\n%s\n' \\
        "https://example.invalid/europe/\$region-260925.osm.pbf" ;;
  esac
  exit 0
fi

case "\$url" in
  *.md5)
    case "\${SHIM_MODE:-ok}" in
      md5-404) exit 22 ;;
      md5-html) printf '<html><head><title>404</title></head>\n' ;;
      *) printf '%s  %s\n' '$GOOD_MD5' "\$(basename "\$url" .md5)" ;;
    esac
    exit 0 ;;
esac

# the extract itself
case "\${SHIM_MODE:-ok}" in
  transfer-fails)
    # A partial body, then a dropped connection — the shape that must
    # leave something on disk to resume from.
    head -c 1024 '$GOOD' >> "\$out"; exit 18 ;;
  bytes-wrong)
    head -c 4096 /dev/zero > "\$out"; exit 0 ;;
  resume-splice-then-good)
    if [ "\$resume" = 1 ]; then head -c 4096 /dev/zero > "\$out"; else cp '$GOOD' "\$out"; fi
    exit 0 ;;
  *) cp '$GOOD' "\$out"; exit 0 ;;
esac
SHIM
chmod +x "$BIN/curl"

# osmium/ogr2ogr/psql: just enough that the load half completes without
# a database, so a scenario can be asserted all the way to "✓ ready".
cat > "$BIN/osmium" <<'SHIM'
#!/usr/bin/env bash
set -uo pipefail
out=''
for ((i=1; i<=$#; i++)); do [ "${!i}" = '-o' ] && { j=$((i+1)); out="${!j}"; }; done
case "$1" in
  export) printf '{"type":"Feature"}\n{"type":"Feature"}\n' > "$out" ;;
  *) : > "$out" ;;
esac
SHIM
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/ogr2ogr"
# The row check compares psql's count with `wc -l` of the export: two.
printf '#!/usr/bin/env bash\necho 2\n' > "$BIN/psql"
chmod +x "$BIN/osmium" "$BIN/ogr2ogr" "$BIN/psql"

# A GNU `stat`: `-c` works, and `-f` prints "? ?" and EXITS 0, which is
# what coreutils actually does (src/stat.c, print_statfs).
cat > "$ROOT/gnu-stat" <<'SHIM'
#!/usr/bin/env bash
# 🔴 /usr/bin/stat by absolute path. `command stat` would find this
# shim again \u2014 it is first on PATH \u2014 and the -f branch would answer
# the -c call with "? ?", which is the very thing being tested for.
#
# 🔴 And the real values are read with the SAME ordering the script
# uses, because the host running this suite may itself be GNU: asking a
# GNU /usr/bin/stat for `-f` returns "? ?" and exit 0, so a BSD-first
# shim answered its own -c branch with "? ?" and failed on Linux while
# passing on macOS. The shim reproduced the bug it was written to catch
# \u2014 twice now, in two different ways.
if [ "${1:-}" = '-c' ]; then
  /usr/bin/stat -c '%s %Y' "$3" 2>/dev/null && exit 0
  /usr/bin/stat -f '%z %m' "$3" 2>/dev/null && exit 0
  exit 1
fi
if [ "${1:-}" = '-f' ]; then echo '? ?'; exit 0; fi
exit 1
SHIM
# A `stat` that can never answer, for the fail-closed case.
printf '#!/usr/bin/env bash\nexit 1\n' > "$ROOT/broken-stat"
chmod +x "$ROOT/gnu-stat" "$ROOT/broken-stat"

# 🔴 The shims are checked before anything relies on them.
#
# Twice now a broken shim has looked exactly like a broken script: once
# recursing into itself, once reading a GNU host with BSD flags. Both
# printed "the script wrote '? ?'", which is a true sentence about the
# wrong program. A fixture that can lie has to be asked first.
fp=$("$ROOT/gnu-stat" -c '%s %Y' "$GOOD")
if ! printf '%s' "$fp" | grep -qE '^[0-9]+ [0-9]+$'; then
  echo "::error::the GNU stat shim answers -c with '$fp', not two numbers." >&2
  echo "          That is a broken fixture, not a broken script." >&2
  exit 1
fi
if [ "$("$ROOT/gnu-stat" -f '%z %m' "$GOOD")" != '? ?' ]; then
  echo "::error::the GNU stat shim must answer -f with '? ?' to be GNU-like." >&2
  exit 1
fi

run() {
  # run <work-dir-name> [extra PATH dir] — prints output, returns exit code
  local wd="$ROOT/$1"; shift
  mkdir -p "$wd"
  local path="$BIN:$PATH"
  [ $# -gt 0 ] && { path="$1:$path"; shift; }
  env PATH="$path" WORK_DIR="$wd" SHIM_MODE="${SHIM_MODE:-ok}" \
    DATABASE_URL='postgres://localhost:5432/selftest_never_used' \
    bash "$SCRIPT" europe/malta 2>&1
}

echo "load-context.sh self-test"

# ── a: a clean fetch writes a marker holding a REAL fingerprint ──────
SHIM_MODE=ok out=$(run a); rc=$?
stamp="$ROOT/a/europe-malta.verified-md5"
if [ $rc -eq 0 ] && [ -f "$stamp" ] &&
   grep -qE "^$GOOD_MD5 [0-9]+ [0-9]+\$" "$stamp"; then
  pass "a clean fetch writes <md5> <size> <mtime>"
else
  fail "a clean fetch should write a real fingerprint; rc=$rc marker='$(cat "$stamp" 2>/dev/null)'"
fi

# ── the second run skips, and says so ───────────────────────────────
SHIM_MODE=ok out=$(run a)
if grep -q 'already verified' <<<"$out"; then
  pass "an unchanged, verified extract is not downloaded again"
else
  fail "the second run should skip: $out"
fi

# ── b: the marker must not vouch for a file that changed ────────────
printf 'tampered' >> "$ROOT/a/europe-malta.osm.pbf"
SHIM_MODE=ok out=$(run a)
if ! grep -q 'already verified' <<<"$out" && grep -q 'checksum ok' <<<"$out"; then
  pass "a file that changed under its marker is fetched again"
else
  fail "a tampered file was skipped: $out"
fi

# ── c: a fingerprint we cannot take must never become a skip ────
#
# 🔴 TWO runs, both with a stat that can never answer — because one
# run does not reach the bug. The fail-open version wrote "<md5> " or
# "<md5> unknown" into the marker, and the DANGER is the next run
# producing the same unanswerable string and matching it. A single run
# passes either way, which is how this mutation survived the first
# version of this test: it was green against the bug it was written for.
mkdir -p "$ROOT/broken-stat-dir"; cp "$ROOT/broken-stat" "$ROOT/broken-stat-dir/stat"
SHIM_MODE=ok out=$(run c "$ROOT/broken-stat-dir")
SHIM_MODE=ok out=$(run c "$ROOT/broken-stat-dir"); rc=$?
stamp="$ROOT/c/europe-malta.verified-md5"
if ! grep -q 'already verified' <<<"$out" && [ ! -f "$stamp" ]; then
  pass "a stat that cannot answer writes no marker, twice running"
else
  fail "a broken stat vouched for a file; rc=$rc marker='$(cat "$stamp" 2>/dev/null)': $out"
fi

# and whatever any marker holds, it is never a placeholder
if ! grep -qE 'unknown|[?]' "$ROOT"/*/europe-malta.verified-md5 2>/dev/null; then
  pass "no marker anywhere holds a placeholder instead of a fingerprint"
else
  fail "a marker holds a placeholder: $(grep -E 'unknown|[?]' "$ROOT"/*/europe-malta.verified-md5 2>/dev/null)"
fi

# ── the GNU trap: `stat -f` answering "? ?" must not become a marker ─
mkdir -p "$ROOT/gnu-dir"; cp "$ROOT/gnu-stat" "$ROOT/gnu-dir/stat"
SHIM_MODE=ok out=$(run g "$ROOT/gnu-dir"); rc=$?
stamp="$ROOT/g/europe-malta.verified-md5"
if [ -f "$stamp" ] && ! grep -q '?' "$stamp" &&
   grep -qE "^$GOOD_MD5 [0-9]+ [0-9]+\$" "$stamp"; then
  pass "on GNU stat the marker holds numbers, not '? ?'"
else
  fail "GNU stat produced marker '$(cat "$stamp" 2>/dev/null)'"
fi

# ── d: a transfer that fails twice KEEPS what arrived ───────────────
SHIM_MODE=transfer-fails out=$(run d); rc=$?
if [ $rc -ne 0 ] && grep -q 'has been KEPT' <<<"$out" &&
   [ -s "$ROOT/d/europe-malta.osm.pbf" ] &&
   [ ! -f "$ROOT/d/europe-malta.verified-md5" ]; then
  pass "two failed transfers keep the partial file and drop the marker"
else
  fail "a failed transfer should keep the file; rc=$rc, file=$(ls -l "$ROOT/d/europe-malta.osm.pbf" 2>/dev/null | wc -l): $out"
fi

# ── e: bytes that are simply wrong ARE deleted ───────────────────────
SHIM_MODE=bytes-wrong out=$(run e); rc=$?
if [ $rc -ne 0 ] && grep -q 'not a transfer problem' <<<"$out" &&
   [ ! -f "$ROOT/e/europe-malta.osm.pbf" ]; then
  pass "twice-wrong bytes are deleted, and said to be the source's fault"
else
  fail "wrong bytes should be deleted; rc=$rc: $out"
fi

# ── the original bug: a rejected splice must never be skipped past ───
SHIM_MODE=resume-splice-then-good out=$(run f); rc=$?
if [ $rc -eq 0 ] && grep -q 'checksum ok' <<<"$out" &&
   grep -q 'starting clean' <<<"$out"; then
  pass "a bad resume is refused and refetched from scratch"
else
  fail "the resume path did not recover; rc=$rc: $out"
fi

# ── f: a redirect that is not this region is refused ─────────────────
SHIM_MODE=redirect-to-index out=$(run h); rc=$?
if [ $rc -ne 0 ] && grep -q 'not an extract named for' <<<"$out"; then
  pass "a redirect to the site index is refused, by name"
else
  fail "a redirect to the index was accepted; rc=$rc: $out"
fi

# A mirror keeps `-latest` in the filename, and that is legitimate.
SHIM_MODE=mirror out=$(run m); rc=$?
if [ $rc -eq 0 ] && grep -q 'checksum ok' <<<"$out"; then
  pass "a mirror that keeps -latest in the name is accepted"
else
  fail "a legitimate mirror redirect was refused; rc=$rc: $out"
fi

SHIM_MODE=redirect-other-region out=$(run i); rc=$?
if [ $rc -ne 0 ] && grep -q 'not an extract named for' <<<"$out"; then
  pass "a redirect onto another region's extract is refused"
else
  fail "another region's extract was accepted; rc=$rc: $out"
fi

# ── the .md5 guard ───────────────────────────────────────────────────
SHIM_MODE=md5-html out=$(run j); rc=$?
if [ $rc -ne 0 ] && grep -q 'no usable .md5' <<<"$out" &&
   [ ! -f "$ROOT/j/europe-malta.osm.pbf" ]; then
  pass "an HTML error page is not accepted as a checksum"
else
  fail "an HTML .md5 body got through; rc=$rc: $out"
fi

# ── g: a second run in one work directory refuses to start ───────────
mkdir -p "$ROOT/k/.lock"; echo $$ > "$ROOT/k/.lock/pid"
SHIM_MODE=ok out=$(run k); rc=$?
if [ $rc -ne 0 ] && grep -q 'is using' <<<"$out"; then
  pass "a live lock stops a second run"
else
  fail "two runs shared a work directory; rc=$rc: $out"
fi

# 🔴 And the run that was turned away must not take the lock with it.
#
# The trap is `rm -rf "$LOCK_DIR"` on EXIT. It is armed AFTER both
# refusal paths, so a blocked run cannot delete the holder's lock — but
# that is an ordering an edit could silently undo, and the damage would
# be two concurrent runs believing they are alone.
if [ -d "$ROOT/k/.lock" ] && [ "$(cat "$ROOT/k/.lock/pid")" = "$$" ]; then
  pass "a run that was turned away leaves the holder's lock alone"
else
  fail "the blocked run removed the lock it did not own"
fi

# a lock left behind by a dead process is taken over, not fatal
mkdir -p "$ROOT/l/.lock"; echo 999999 > "$ROOT/l/.lock/pid"
SHIM_MODE=ok out=$(run l); rc=$?
if [ $rc -eq 0 ] && grep -q 'left a lock behind' <<<"$out"; then
  pass "a lock from a dead run is taken over and said out loud"
else
  fail "a stale lock blocked the run; rc=$rc: $out"
fi

# and the lock is released on the way out
if [ ! -d "$ROOT/a/.lock" ]; then
  pass "the lock is released when the run ends"
else
  fail "the lock outlived the run"
fi

# ── an empty HOME must not mean the filesystem root ──────────────────
out=$(env -u WORK_DIR HOME='' PATH="$BIN:$PATH" bash "$SCRIPT" europe/malta 2>&1); rc=$?
if [ $rc -ne 0 ] && grep -q 'nowhere to put' <<<"$out"; then
  pass "an empty HOME is refused, not turned into /camptribe-osm"
else
  fail "an empty HOME was accepted; rc=$rc: $out"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "self-test passed"
else
  echo "::error::$FAILURES self-test failure(s) in load-context.sh" >&2
  exit 1
fi
