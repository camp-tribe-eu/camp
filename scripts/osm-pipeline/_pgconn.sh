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

# 🔴 libpq splits key=value pairs on whitespace, so a value that contains
# a space, a quote or a backslash must be quoted or everything after it
# is read as a different keyword. A generated password is exactly where
# those characters come from, and the failure arrives as an
# authentication error that names nothing in this file.
def q(value):
    v = str(value)
    if v and not any(c in v for c in " \t\n'\\"):
        return v
    return "'" + v.replace("\\", "\\\\").replace("'", "\\'") + "'"

u = urllib.parse.urlparse(sys.argv[1])
parts = [f"dbname={q(urllib.parse.unquote(u.path.lstrip('/')) or 'postgres')}"]
if u.hostname: parts.append(f"host={q(u.hostname)}")
if u.port: parts.append(f"port={q(u.port)}")
if u.username: parts.append(f"user={q(urllib.parse.unquote(u.username))}")
if u.password: parts.append(f"password={q(urllib.parse.unquote(u.password))}")

# 🔴 Everything after the `?` used to be dropped, `sslmode=require`
# included — invisible against a local socket, fatal against every
# managed Postgres there is. libpq's URI parameters are its keywords,
# one for one, so they carry across unchanged.
seen = {p.split('=', 1)[0] for p in parts}
for key, values in urllib.parse.parse_qs(u.query, keep_blank_values=True).items():
    if key in seen:
        continue  # the URL's own host/user/port stay authoritative
    if not key.replace('_', '').isalnum():
        sys.exit(f"DATABASE_URL carries a parameter libpq cannot name: {key}")
    parts.append(f"{key}={q(values[-1])}")

print(" ".join(parts))
PYEOF
}
