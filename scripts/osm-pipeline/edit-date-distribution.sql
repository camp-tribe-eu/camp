-- CAMP-256: how the OpenStreetMap edit dates in camping_spots are distributed.
--
--   psql "$DATABASE_URL" -f scripts/osm-pipeline/edit-date-distribution.sql
--   psql "$DATABASE_URL" -v only=AT -f scripts/osm-pipeline/edit-date-distribution.sql
--
-- READ-ONLY. Writes nothing, creates nothing; safe against any database.
--
-- 🔴 WHY THIS EXISTS. The card's own words: "if every record is suddenly
-- 2026, the import wrote the load date instead of the OSM edit date. It is
-- the most likely mistake here and it looks like success." Nothing throws,
-- every count matches, and every page says "Record last edited: October
-- 2026". The ONLY thing that exposes it is the shape of the dates, and this
-- prints it: a spread over fifteen years is real; one tall bar on the
-- current year is the load date.
--
-- It reads `osm_record_edited_at` and `last_seen_at` — the two dates that
-- must never be confused — side by side. Read it with the card's reference
-- in hand (47 603 objects, 25.09.2026): 2026 = 26.0 %, 2025 = 22.9 %, older
-- than 2 years = 31.8 %, older than 3 = 20.2 %, older than 5 = 12.3 %. A
-- different population will not match to the decimal; a 2026 share near
-- 100 % is not a rounding difference.
--
-- Rows counted: OpenStreetMap-sourced (osm_ref present), live (not marked
-- missing). DATAtourisme rows have no OSM object and no date by
-- construction, so they are not in the denominator of anything below.

\if :{?only}
\else
  \set only ''
\endif

\echo
\echo '== 1. how many OSM rows have a date at all'
SELECT count(*)                                              AS osm_rows,
       count(osm_record_edited_at)                           AS dated,
       count(*) - count(osm_record_edited_at)                AS not_known,
       round(100.0 * count(osm_record_edited_at)
             / NULLIF(count(*), 0), 1)                       AS pct_dated
  FROM camping_spots
 WHERE osm_ref IS NOT NULL AND missing_since IS NULL
   AND (:'only' = '' OR country = :'only');

\echo
\echo '== 2. dated rows by year of the edit (UTC)'
SELECT extract(year FROM osm_record_edited_at AT TIME ZONE 'UTC')::int AS year,
       count(*)                                                        AS rows,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1)              AS pct
  FROM camping_spots
 WHERE osm_ref IS NOT NULL AND missing_since IS NULL
   AND osm_record_edited_at IS NOT NULL
   AND (:'only' = '' OR country = :'only')
 GROUP BY 1
 ORDER BY 1;

\echo
\echo '== 3. the card''s buckets, by calendar year as the card counted them'
WITH d AS (
  SELECT extract(year FROM osm_record_edited_at AT TIME ZONE 'UTC')::int AS y,
         extract(year FROM now())::int                                   AS this_year
    FROM camping_spots
   WHERE osm_ref IS NOT NULL AND missing_since IS NULL
     AND osm_record_edited_at IS NOT NULL
     AND (:'only' = '' OR country = :'only')
)
SELECT count(*)                                                       AS dated,
       round(100.0 * count(*) FILTER (WHERE y = this_year)     / NULLIF(count(*), 0), 1) AS this_year_pct,
       round(100.0 * count(*) FILTER (WHERE y = this_year - 1) / NULLIF(count(*), 0), 1) AS last_year_pct,
       round(100.0 * count(*) FILTER (WHERE y <= this_year - 3) / NULLIF(count(*), 0), 1) AS older_than_2y_pct,
       round(100.0 * count(*) FILTER (WHERE y <= this_year - 4) / NULLIF(count(*), 0), 1) AS older_than_3y_pct,
       round(100.0 * count(*) FILTER (WHERE y <= this_year - 6) / NULLIF(count(*), 0), 1) AS older_than_5y_pct
  FROM d;

\echo
\echo '== 4. the substitution test: edit date within 48 h of the import that last saw the row'
\echo '   real data: a fraction of one percent, and ~0 when the import ran weeks after the extract was cut.'
\echo '   (measured on the 27 extracts of 24.09.2026, against each extract''s own date: Finland 13.7 %, every other country 0.45 % or less.)'
\echo '   the load date written over the edit date: 100 %.'
SELECT count(*) FILTER (WHERE osm_record_edited_at >= last_seen_at - interval '48 hours')
                                                                AS edited_within_48h_of_import,
       count(*)                                                 AS dated,
       round(100.0 * count(*) FILTER (WHERE osm_record_edited_at >= last_seen_at - interval '48 hours')
             / NULLIF(count(*), 0), 2)                          AS pct,
       CASE WHEN count(*) >= 100
             AND count(*) FILTER (WHERE osm_record_edited_at >= last_seen_at - interval '48 hours')
                 >= 0.9 * count(*)
            THEN 'RED: the dates are the date of the load, not OSM edit dates'
            ELSE 'ok' END                                       AS verdict
  FROM camping_spots
 WHERE osm_ref IS NOT NULL AND missing_since IS NULL
   AND osm_record_edited_at IS NOT NULL
   AND (:'only' = '' OR country = :'only');
