# Where the data lives, and what happens if a machine dies

CAMP-103. Written 23.09.2026 from measurements, not assumptions.

## The question this answers

The database currently runs on one laptop, and that is a reasonable place
for it: no server is needed to start accumulating campsites, and there is
no hosting bill for data nobody is serving yet. The question is not
whether the laptop is a good place. It is **what exactly is lost if it
stops working**, and the answer is not the same for every table.

## Replaceable and not

| What | Where it comes from | If the laptop dies |
| --- | --- | --- |
| Campsite name, location, amenities | OpenStreetMap via Geofabrik | Downloaded again in minutes |
| `osm_ctx_water`, `osm_ctx_place`, `osm_ctx_poi` (78 MB) | Same | Same |
| `ne_admin1` boundaries | Natural Earth | Same |
| **`camping_spots.context`** | **computed by us** | **weeks to months** |
| **`camping_spots.owner_overrides`** | **typed by a human** | **gone — no source exists** |
| **`reviews`, `photo_submissions`** | **the public** | **gone** |
| **`guides`, `routes`** | **our writing** | **gone** |
| **`missing_since`, `content_changed_at`** | **accumulated history** | every campsite looks new today, which resets the "gone" logic and every sitemap date at once |
| `spot_links` (the 2 986 links) | recomputed by `reconcile-sources.ts` | minutes — rerun it |
| **`spot_links.unlinked_at` (a person's "this match is wrong")** | **typed by a human** | **gone — and the reconciler would relink the pair** |

### `spot_links` is not in the backup, on purpose

CAMP-144 joins the row OpenStreetMap wrote to the row DATAtourisme wrote
for the same campsite. The links themselves are cheap: `reconcile-sources.ts`
rebuilds all 2 986 in under a second from the rows it finds.

What is not cheap is a person having decided a link was **wrong**, which
is recorded as `unlinked_at`. That is the same category as
`owner_overrides` — judgement with no upstream source — and it is worse
than merely lost, because the reconciler skips a pair it has already
judged, so losing the row means the next run silently recreates the link
the person removed.

🔴 It is still not in `TABLES`, and adding it there would be worse than
leaving it out. Every row in it is a pair of `camping_spots.id` uuids,
and the spots backup carries `osm_ref`, not `id` — a rebuilt database
gives every campsite a fresh uuid. Restored into it, those links would
hit a foreign key and fail, and a backup that cannot be restored is a
folder. Backing this up properly means exporting it against stable
identities (`osm_ref` on one side, the DATAtourisme URI on the other) and
resolving them on the way back in — a restore path of its own, which
needs its own self-test.

Today there are **0** undone links, so nothing is at risk yet. The day
somebody undoes the first one, this becomes real.

### Why `context` is the expensive one

`context` is what is around each campsite — the lake 98 m away, the town
2.6 km off, the elevation, the terrain. The distances come from PostGIS
and are cheap. The elevation comes from Open-Meteo's DEM endpoint, and
its free tier is rationed **per coordinate per day, not per request**. We
sample 8 points around each site for the relief classification, so one
campsite is nine coordinates.

Measured on 23.09.2026: a full day's allowance moved **6 campsites** of
the 778 in Croatia before the quota stopped the run.

Current state: **289 of 1079 campsites have a computed context.** At the
observed rate, recomputing just those is weeks. Recomputing the Europe we
intend to hold is not a plan, it is a year. That is the whole reason this
document exists.

All of the irreplaceable material together is about **120 kB**. The cost
of keeping a second copy is nothing; the cost of not keeping one is
everything we have spent on it.

## What is now automatic

### The weekly OSM extract keeps its output

`\.github/workflows/osm-weekly.yml` used to publish an artifact with
`retention-days: 14`, and nothing imported it, so every run's work
evaporated a fortnight later. It now publishes a **GitHub Release**:
free on a public repository, no expiry, downloadable by URL from any
machine. Releases older than the last 26 are pruned so the list stays
readable.

It also covers nine countries instead of two, one job each, in parallel —
`fail-fast: false`, so France having a bad day costs France only.

The release notes carry the ODbL attribution, because publishing a
release asset is redistribution of an OpenStreetMap-derived database, not
merely displaying it.

### Something notices when the job stops

`.github/workflows/watchdog.yml` runs daily and opens an issue if a
watched job has not **succeeded** in more than 8 days. The existing
`if: failure()` alert inside the weekly job could never catch this: it
needs a run to fail, and the state we were actually in was *no runs at
all*. Confirmed on 23.09.2026 — `gh run list --workflow=osm-weekly.yml
--event=schedule` returned nothing, while the Actions tab showed the
workflow as active.

Known hole, stated rather than papered over: GitHub disables scheduled
workflows after 60 days of repository inactivity, and it would disable
the watchdog alongside the job. This catches a cron that broke. It cannot
catch a project that was abandoned, because the thing that would report
that is the thing that stopped.

## What is yours to do

One command, and it takes about a second:

```bash
./scripts/osm-pipeline/backup-local.sh backup
```

It writes to `~/CampTribe-backups/<today>/` — **outside the repository**,
because the repository is public and a backup holds every review and
every correction we own. It verifies itself immediately: a backup nobody
has read back is a folder, not a backup.

Then copy that folder somewhere that is not this laptop. iCloud, an
external disk, anywhere — the requirement is only that it is a second
physical thing. The CSV half is about 120 kB; the full dump beside it
(below) is about 199 MB on production, measured 22.10.2026.

### The full dump beside the CSVs (CAMP-386)

The CSVs carry eight content tables and nothing else. Measured on a
fresh production snapshot, 22.10.2026: the database also holds **208
`directus_*` objects** — collections, fields, relations, flows,
operations, users, roles, policies, permissions and settings — and none
of them was in the backup. The expensive one is
`directus_settings.project_id`: the Directus licence activation is bound
to `project_id` + `PUBLIC_URL`, there are five activations, and a lost
database restored from CSV gets a *new* `project_id`, so the old
activation holds its slot forever.

So every backup folder now also holds `camptribe.dump`, a `pg_dump -Fc`
of the whole database, mode `0600` (it carries password hashes and the
licence token). `verify` reads its **content**, not its presence:
`pg_restore -l` must list `TABLE DATA` for `directus_settings` and
`directus_flows`, or the folder does not verify — a dump that exists,
checksums correctly and carries no Directus is the same defect with a
new name. `scripts/osm-pipeline/backup-local.selftest.sh` hands `verify`
exactly such dumps and requires red.

The dump is for the other disaster — "the database is gone" — and it
restores by replacement, not by merge, so only into an **empty** database:

```bash
createdb camptribe_restored
pg_restore --no-owner --exit-on-error -d camptribe_restored ~/CampTribe-backups/2026-10-22/camptribe.dump
psql camptribe_restored -tAc 'SELECT project_id FROM directus_settings'   # must be the old one
```

The nightly `backup-verify.yml` does exactly this and compares
`project_id` before and after. Retention is the same 14 daily folders as
the CSVs, because the dump lives inside the folder.

A folder made before CAMP-386 has no dump and no `"dump"` key in its
manifest. `verify` says so loudly and still passes, and `restore` from it
still works — for the CSV half only. A folder whose manifest *names* a
dump that is missing, altered or empty of Directus fails hard; that
distinction is what keeps the old folders usable without letting a new
backup quietly lose its dump.

To check a backup you already have:

```bash
./scripts/osm-pipeline/backup-local.sh verify ~/CampTribe-backups/2026-09-23
```

To put it back into a database:

```bash
./scripts/osm-pipeline/backup-local.sh restore ~/CampTribe-backups/2026-09-23
```

### Restore cannot destroy newer work

This matters more than the backup itself. A restore that overwrote a
fresh context with a stale one would *be* the disaster this script exists
to prevent, and it would do it silently.

So an incoming row is written only when it is not empty **and** genuinely
newer; a human correction already in the database is never overwritten;
first-seen dates widen to the earliest evidence and last-changed dates
never go backwards. Running the same backup twice changes nothing.

Those rules are three `WHERE` clauses, and a `WHERE` clause nobody has
tried to break is a comment. `backup-local.sh --self-test` drives them
against temp tables in CI, and it was checked by removing the guard,
which makes it fail.

## What is deliberately not here

**Importing into a live database from CI.** That needs a database a
GitHub runner can reach, and giving a third-party runner a route into
ours means opening it to the internet for the sake of a cron job. The
order is: server first (CAMP-97, CAMP-99), then that machine pulls the
release asset and imports locally. This card's job was to make sure that
by the time the server exists there are **months of data waiting**
instead of nothing.

The server exists now, and the section below says what that machine
actually does — because until 16.10.2026 this page described a procedure
that had never run (CAMP-332). A document that describes a path nobody
has walked is worse than no document: people plan against it.

## How the import actually runs (CAMP-332, proven 16.10.2026)

**`gdal-bin` and `gh` are not installed on the server, and that is the
decision, not an omission.** `import-release.mjs` originally shelled out
to `gh` to find the release asset and to `ogr2ogr` to load the GeoJSON
into staging. Installing GDAL on a production box drags a large
dependency tail onto a machine that serves the site, for a job that node
and `psql` can do themselves. So the script lost both dependencies
instead (PR #267, PR #269).

It needs **node and nothing else**. The PATH it hands its own child is a
directory containing one symlink to `process.execPath`, so a build that
quietly started depending on some other binary fails on a developer's
laptop, not for the first time on the server at 03:00.

**The proof run.** Malta, 16.10.2026, on the live machine:

* `osm_camping_staging` appeared in the production database **for the
  first time** — 14 rows. Before this run `pg_tables` matched nothing on
  `%staging%`, which is how we knew the documented path had never
  executed;
* Malta's rows carry `last_seen_at = 2026-10-16 17:06 UTC`, against
  `2026-10-11` for every other country — so the freshness is this run's,
  not a leftover;
* the live page `/camping/mt/mellieha/adventure-campsite` reads *"Record
  last edited: February 2026 — within the last year"*, and the row says
  `2026-02-24`. Same value, read off the page a visitor would get.

🔴 **An import on its own changes no page.** The site is prerendered: the
rows moved at 17:06 UTC and the page still showed nothing until the
release built at 20:08–20:16 UTC that evening. Any plan that ends at
"the import succeeded" ends one step early — the data reaches readers at
the next build, and nowhere before it.

**What this does not yet cover.** The weekly workflow that publishes
per-country assets, and the machine pulling them on a schedule, are still
CAMP-97 and CAMP-99. The difference now is that the last mile is measured
rather than assumed.

## The full EU-27 run (17.10.2026)

Release `osm-2026-10-16`, run on the machine by hand. **23 of 27 in 312
seconds**; the other four came in on a retry a minute later.

| | before | after |
| --- | --- | --- |
| rows in `camping_spots` | 63 031 | 63 159 |
| rows carrying an OSM edit date | **301** | **47 534 (75.3%)** |

🔴 **FOUR COUNTRIES FAILED, AND SIZE DOES NOT EXPLAIN WHICH FOUR.**
`DK`, `ES`, `IT` and `FR` each answered `fetch failed`. Three of them are
among our five biggest — so the tempting sentence is "the big ones time
out". It is wrong: `DK` is **8th of 27 with 2 055 rows**, while `DE`
(2nd, 9 690), `NL` (4th, 3 894) and `SE` (6th, 2 369) all came through in
the same run. What the four do share is position — 21st, 23rd, 25th and
27th of 27, interleaved with those successes — and that every one of them
succeeded when asked again a minute later.

The operational conclusion does not depend on knowing the cause:
**a retry is not optional.** Measured on this run — after the first pass
the table held 25 360 dated rows (40.2%); the retry of those four took it
to 47 534 (75.3%). **22 174 of the dates, 47% of everything we have, came
from the retry alone.** Without one, the night a timer fires is the night
France — 23 887 campsites, 38% of the table — silently keeps yesterday's
data.

🔴 **AND THE EXIT CODE IS RIGHT; THE WAY I READ IT WAS NOT.**
`import-release.mjs` sets `process.exitCode = 1` when any state failed
(line ~2759). I ran it as `node … | tail | sed`, read `$?`, saw `0`, and
nearly filed a defect against the script. A pipeline reports its LAST
command's code. Measured on the spot, with a tag that does not exist:

```
node … | tail >/dev/null                    -> 0
( set -o pipefail; node … | tail >/dev/null ) -> 1
node … >/dev/null                            -> 1
```

CI already knows this: both self-test steps in `ci.yml` open with
`set -o pipefail` and a comment saying Actions runs `bash -e {0}` without
it. Anyone running this by hand needs the same.

**Where the remaining 25 625 rows without a date come from**, so that the
number is not mistaken for a defect:

* **8 752 have no `osm_ref` at all** — they did not come from OSM
  (DATAtourisme and the rest). There is no date to carry.
* **6 873 have an `osm_ref` but were not touched by this run** — their
  object is no longer in the current extract. Deleted or retagged in OSM
  since we first saw it; related to CAMP-279.

**The distribution reproduces what CAMP-256 measured in September**, which
is the point of that card's check — if an import had stamped the download
date instead of the OSM one, 2026 would be 100%:

| last edited | card (25.09, 47 603) | now (16.10, 47 534) |
| --- | --- | --- |
| 2026 | 12 398 (26.0%) | 13 089 (27.5%) |
| 2025 | 10 889 (22.9%) | 10 579 (22.3%) |
| untouched 2 years+ | 15 129 (31.8%) | 14 866 (31.3%) |
| untouched 5 years+ | 5 874 (12.3%) | 5 700 (12.0%) |

🔴 The right-hand column counts CALENDAR years (`< 2024`). Counting "two
years back from today" over the same rows gives **45.6%** instead of
31.3% — a different question with a similar-looking answer. Check which
of the two a card means before quoting a number at it; both are true and
only one answers the question asked.

**Publishing the computed context.** The raw extract in the release is
OpenStreetMap data under ODbL and belongs in public. The computed context
is the one thing we have that competitors do not, and a bulk download of
it is a different act from showing it on a campsite page. It stays local
until there is a reason and a licence decision.
