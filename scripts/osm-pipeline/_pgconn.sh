#!/usr/bin/env bash
# Shared: turn a DATABASE_URL into what ogr2ogr actually wants.
#
# 🔴 ogr2ogr needs a libpq key=value string, not a URL, and it fails in a
# way that names neither.
#
# Given `PG:postgres://…` GDAL appends `application_name='GDAL x.y'` to the
# URL without a `?`, and libpq rejects the result with "unexpected spaces
# found in …". Given `PG:host:port/db` — a URL with the scheme merely
# stripped, which is what load-context.sh used to do — GDAL reads it as a
# database name and tries to CREATE that database.
#
# That second form is the dangerous one: it printed "ERROR 1" and the
# layer simply did not load. The context layers stayed at their previous
# contents, the next step computed every campsite's surroundings against
# a country that was no longer the right one, and nothing anywhere said
# so. Hence one function, used by both scripts.

pg_conninfo() {
  local url="$1"
  if [[ "$url" != postgres://* && "$url" != postgresql://* ]]; then
    # Already a key=value string.
    printf '%s' "$url"
    return
  fi
  python3 - "$url" <<'PYEOF'
import sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
parts = [f"dbname={u.path.lstrip('/') or 'postgres'}"]
if u.hostname: parts.append(f"host={u.hostname}")
if u.port: parts.append(f"port={u.port}")
if u.username: parts.append(f"user={urllib.parse.unquote(u.username)}")
if u.password: parts.append(f"password={urllib.parse.unquote(u.password)}")
print(" ".join(parts))
PYEOF
}
