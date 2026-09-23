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
physical thing. 120 kB fits anywhere.

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

**Publishing the computed context.** The raw extract in the release is
OpenStreetMap data under ODbL and belongs in public. The computed context
is the one thing we have that competitors do not, and a bulk download of
it is a different act from showing it on a campsite page. It stays local
until there is a reason and a licence decision.
