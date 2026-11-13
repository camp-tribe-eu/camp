
-- 🔴 CAMP-502: one campsite of the fixture has a motorway and an airport near it.
--
-- A SEPARATE FILE, APPENDED BY regenerate.sh, for the reason
-- `ci-seed-page-outline.sql` gives: `ci-seed.sql` is a GENERATED artifact, and
-- a block written into it by hand is erased by the next regeneration.
--
-- WHY IT IS NEEDED. `osm_ctx_hazard` is created EMPTY by its migration, and
-- the layer itself (2 985 001 rows for the EU-27) is not something a fixture
-- holds. With an empty table the «Possible disturbance» block, the «!» pins on
-- the campsite map and the line under the map are drawn on NO page of the
-- fixture, and every browser test of them would be a pass over nothing
-- (review of #557: the pins had no test at all).
--
-- BUILT FROM THE ROW'S OWN POINT, never from typed coordinates: a motorway
-- 0.005 deg north (556 m: inside the 1 000 m radius, and inside the map's
-- first view) and an airport 0.04 deg north (4 448 m: inside the 5 000 m
-- radius, OUTSIDE the first view — the case the map must not zoom out for).
-- Typed coordinates would drift from the row at the next regeneration.
--
-- THE SAME ROW AS THE OUTLINE (`ci-seed-page-outline.sql`), by the same
-- predicate and order, so one page exercises the outline fit and the pins
-- together — the two used to fight over the map's frame.
-- 🔴 `INSERT … VALUES`, one row a statement: the fixture guard
-- (check-fixture-not-shrunk.mjs) counts rows only in that form, and a count
-- it cannot make must not read as zero.
INSERT INTO osm_ctx_hazard (geom, name, highway, aeroway, iata) VALUES ((SELECT ST_MakeLine(ST_Translate(c.location, -0.1, 0.005), ST_Translate(c.location, 0.1, 0.005)) FROM camping_spots c WHERE c.id = (
     SELECT s.id FROM camping_spots s
      WHERE s.missing_since IS NULL
        AND s.region IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM spot_links l
                    JOIN camping_spots lp ON lp.id = l.primary_id
                   WHERE l.secondary_id = s.id
                     AND l.unlinked_at IS NULL
                     AND lp.missing_since IS NULL
                     AND lp.region IS NOT NULL)
      ORDER BY s.country, s.region, s.slug
      LIMIT 1)), 'A1', 'motorway', NULL, NULL);
INSERT INTO osm_ctx_hazard (geom, name, highway, aeroway, iata) VALUES ((SELECT ST_Translate(c.location, 0, 0.04) FROM camping_spots c WHERE c.id = (
     SELECT s.id FROM camping_spots s
      WHERE s.missing_since IS NULL
        AND s.region IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM spot_links l
                    JOIN camping_spots lp ON lp.id = l.primary_id
                   WHERE l.secondary_id = s.id
                     AND l.unlinked_at IS NULL
                     AND lp.missing_since IS NULL
                     AND lp.region IS NOT NULL)
      ORDER BY s.country, s.region, s.slug
      LIMIT 1)), 'Fixture Airport', NULL, 'aerodrome', 'FIX');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM osm_ctx_hazard;
  IF n <> 2 THEN
    RAISE EXCEPTION 'CI fixture: osm_ctx_hazard holds % rows, expected the 2 seeded here', n;
  END IF;

  -- 🔴 The branch "has pins" must be reachable: a campsite with a page,
  -- a motorway within 1 000 m AND an airport between 1 200 m and 5 000 m.
  SELECT count(*) INTO n FROM camping_spots s
   WHERE s.missing_since IS NULL AND s.region IS NOT NULL
     AND EXISTS (SELECT 1 FROM osm_ctx_hazard x WHERE x.highway = 'motorway'
                    AND ST_DWithin(s.location::geography, x.geom::geography, 1000))
     AND EXISTS (SELECT 1 FROM osm_ctx_hazard x WHERE x.aeroway = 'aerodrome' AND x.iata IS NOT NULL
                    AND ST_DWithin(s.location::geography, x.geom::geography, 5000)
                    AND NOT ST_DWithin(s.location::geography, x.geom::geography, 1200));
  IF n < 1 THEN
    RAISE EXCEPTION 'CI fixture: no campsite has both a near motorway and a far airport — the pins branch is unreachable';
  END IF;

  -- 🔴 And the other branch: a campsite with nothing near, so "no block,
  -- no pins, no line" is tested on a real page too.
  SELECT count(*) INTO n FROM camping_spots s
   WHERE s.missing_since IS NULL AND s.region IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM osm_ctx_hazard x
                      WHERE ST_DWithin(s.location::geography, x.geom::geography, 5000));
  IF n < 1 THEN
    RAISE EXCEPTION 'CI fixture: every campsite is near a hazard row — the "nothing near" branch is unreachable';
  END IF;
  RAISE NOTICE 'CI fixture: both disturbance branches reachable';
END $$;
