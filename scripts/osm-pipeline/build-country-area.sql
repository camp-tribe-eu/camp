-- CAMP-296: where each country ends, built from what load-country-boundaries.sh staged.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--        -f scripts/osm-pipeline/build-country-area.sql
--
-- with `camp.eu` set to the member list, as a Postgres array literal:
--
--   PGOPTIONS="-c camp.eu={at,be,...}" psql ...
--
-- 🔴 NO psql META-COMMANDS AND NO :variables IN THIS FILE, ON PURPOSE.
-- The loader runs it through psql; apps/api/src/osm/context-sql.spec.ts
-- runs the SAME text through node-postgres against fixture rows. A file
-- that only psql can read would leave the spec rehearsing its own copy of
-- the SQL, and a rehearsal that writes its own query proves nothing about
-- the one that ships. The member list arrives as a setting for the same
-- reason: a custom GUC is the one channel both clients can set.
--
-- 🔴 NO BEGIN / COMMIT HERE EITHER. The caller owns the transaction
-- (`--single-transaction` in the loader, BEGIN / ROLLBACK in the spec), so
-- the gate below can abort the whole swap and leave the PREVIOUS
-- osm_country_area exactly as it was. A half-built replacement is the
-- worst outcome: every campsite would then read as having no town.
--
-- 🔴 THREE SOURCES FOR ONE COUNTRY, IN ORDER, AND WHY THERE ARE THREE.
--
-- Measured 14.10.2026 against the 27 Geofabrik extracts on disk:
--
--   1. the country's own relation (admin_level=2, ISO3166-1:alpha2).
--      osmium assembles it into a polygon for 24 of the 27 members.
--   2. France, Spain and the Netherlands have NO assembled country
--      polygon: their relations list members that sit outside the
--      extract (overseas territories, the Caribbean), and osmium
--      refuses to assemble an incomplete relation. Their regions
--      (admin_level 3/4, ISO3166-2 FR-… / ES-… / NL-…) are complete in
--      the same extract, and the union of them IS the territory the
--      extract covers.
--   3. Ceuta (ES-CE) is a region whose relation is clipped by the extract
--      (14 outer ways listed, 10 present). Those 10 close into rings on
--      their own, so they are polygonised here. Without this, the two
--      Ceuta campsites would lose their own town: Ceuta is in Spain and
--      in the Union, and nothing else assembles it.
--
-- 🔴 WHY OSM AND NOT Natural Earth. `ne_admin1` was the card's proposal and
-- it answers this question wrongly exactly where it matters — measured on
-- the live table, which polygon CONTAINS the town:
--
--   Крылово (Kaliningrad)  PL:Warmian-Masurian   ← Russia read as Poland
--   Bad Säckingen (DE)     CH:Aargau             ← Germany read as Switzerland
--   Metković (HR)          BA:Herzegovina-Neretva
--   Narva (EE)             RU:Leningrad
--
-- A filter built on it would keep the Russian town and drop the German,
-- Croatian and Estonian ones: worse than no filter. OSM draws the border
-- where the border is, and it is the same source the campsites come from.

DROP TABLE IF EXISTS osm_country_area_new;

CREATE TABLE osm_country_area_new (
  iso  text NOT NULL,
  geom geometry(Polygon, 4326) NOT NULL
);

-- Pieces of at most 256 vertices. Germany alone is 159 000 vertices; a
-- point-in-polygon test against one such geometry reads all of it, against
-- a GiST index of small pieces it reads one or two.
INSERT INTO osm_country_area_new (iso, geom)
SELECT u.iso, ST_Subdivide(u.g, 256)
  FROM (
    SELECT p.iso,
           ST_CollectionExtract(ST_MakeValid(ST_Union(p.g)), 3) AS g
      FROM (
        -- 1. the country's own relation
        SELECT lower(s.iso1) AS iso, ST_MakeValid(s.geom) AS g
          FROM osm_country_staging s
         WHERE s.lvl = '2' AND s.iso1 ~ '^[A-Z]{2}$'

        UNION ALL

        -- 2. no relation for the country: its regions
        SELECT lower(left(s.iso2, 2)), ST_MakeValid(s.geom)
          FROM osm_country_staging s
         WHERE s.lvl IN ('3', '4') AND s.iso2 ~ '^[A-Z]{2}-'
           AND NOT EXISTS (
                 SELECT 1 FROM osm_country_staging c
                  WHERE c.lvl = '2' AND lower(c.iso1) = lower(left(s.iso2, 2)))

        UNION ALL

        -- 3. a region the extract clips: rebuilt from the ways it does hold
        SELECT lower(left(l.iso2, 2)), (ST_Dump(ST_Polygonize(l.geom))).geom
          FROM (
            SELECT iso2, (ST_Dump(ST_LineMerge(ST_Union(geom)))).geom AS geom
              FROM osm_country_lines
             GROUP BY iso2
          ) l
         GROUP BY l.iso2
      ) p
     GROUP BY p.iso
  ) u;

-- 🔴 THE GATE. Every member state must have a polygon, or nothing is
-- swapped. Without it a missing country does not fail anywhere: the filter
-- in compute-context then excludes every town, shop and station of that
-- country, and its campsites quietly lose their surroundings.
DO $gate$
DECLARE
  missing text[];
BEGIN
  SELECT array_agg(m ORDER BY m)
    INTO missing
    FROM unnest(current_setting('camp.eu')::text[]) AS m
   WHERE NOT EXISTS (SELECT 1 FROM osm_country_area_new a WHERE a.iso = m);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'osm_country_area: no polygon for %', array_to_string(missing, ', ');
  END IF;
END
$gate$;

CREATE INDEX osm_country_area_new_geom_idx ON osm_country_area_new USING GIST (geom);
CREATE INDEX osm_country_area_new_iso_idx  ON osm_country_area_new (iso);

DROP TABLE IF EXISTS osm_country_area;
ALTER TABLE osm_country_area_new RENAME TO osm_country_area;
ALTER INDEX osm_country_area_new_geom_idx RENAME TO osm_country_area_geom_idx;
ALTER INDEX osm_country_area_new_iso_idx  RENAME TO osm_country_area_iso_idx;
