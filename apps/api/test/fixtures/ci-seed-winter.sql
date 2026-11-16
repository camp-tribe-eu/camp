-- 🔴 CAMP-525: two campsites of the fixture are RECORDED as open in winter,
-- with services mapped near them — so /camping/winter has something to say.
--
-- A SEPARATE FILE, APPENDED BY regenerate.sh, for the reason
-- `ci-seed-page-outline.sql` gives: `ci-seed.sql` is a GENERATED artifact, and
-- a block written into it by hand is erased by the next regeneration. The
-- development database holds no `travel_styles` rows of its own to select
-- (the column is new with CAMP-520), and a fixture with none makes the winter
-- page render «nothing recorded yet» for every browser test of it: a pass
-- over nothing.
--
-- WHAT IS SEEDED, and what the page must therefore say (hand counts of the
-- fixture, 72 visible campsites: 37 in HR, 35 in SI):
--
--   HR · Zadarska · `adria`   sourced yes  (osm:seasonal=no)
--   HR · Primorsko-Goranska   one campsite recorded CLOSED in winter (a sourced no)
--   SI · Borovnica            sourced yes  (osm:opening_hours=24/7) — its only campsite
--
--   Croatia  : 1 open in winter, recorded for 2 of 37
--   Slovenia : 1 open in winter, recorded for 1 of 35
--
-- 🔴 CHOSEN SO THAT NO EXISTING PAGE MOVES. Zadarska has 30 campsites, so one
-- record is 3.3 % — below the 5 % floor, the region hub draws no «Open in
-- winter» chip there. Borovnica is a one-campsite region (a thin, noindex
-- hub); its chip is the only one the fixture adds, and no browser test names
-- that region. The closed campsite is the proof that «recorded closed» is
-- NOT in the winter figure: it is a known record that is not a yes.
--
-- 🔴 SERVICES, placed from the campsite's OWN point so a regeneration cannot
-- leave them stranded (typed coordinates would drift):
--
--   adria (HR)   water 3 000 m, dump 9 900 m — both inside 10 km;
--                gas 10 100 m on a 45° bearing — INSIDE the bounding box the
--                query bounds its index walk with and OUTSIDE the circle,
--                the case only the distance test can refuse
--   Borovnica    dump 2 000 m; nothing else
--
--   water  HR 1 of 1, SI 0 of 1 · dump HR 1 of 1, SI 1 of 1 · gas HR 0 of 1, SI 0 of 1
--
-- 🔴 DUE SOUTH, not north, for the Croatian points: the curated Dalmatia route
-- has a stage in Zadar, and a dump point within 25 km of it would turn the
-- «we hold no disposal point» line on its route page into a point — a change
-- to a page this card does not own. South of `adria` is 30+ km from every
-- stage; the DO block below asserts it rather than trusting this paragraph.
--
-- 🔴 `INSERT … VALUES`, one row a statement: the fixture guard
-- (check-fixture-not-shrunk.mjs) counts rows only in that form.

UPDATE camping_spots
   SET travel_styles = '{"winter": {"value": "yes", "source": "osm:seasonal=no"}}'::jsonb
 WHERE region = 'Zadarska' AND slug = 'adria' AND missing_since IS NULL;

UPDATE camping_spots
   SET travel_styles = '{"winter": {"value": "no", "source": "osm:opening_hours=Apr-Oct"}}'::jsonb
 WHERE id = (SELECT id FROM camping_spots
              WHERE region = 'Primorsko-Goranska' AND missing_since IS NULL
              ORDER BY slug LIMIT 1);

UPDATE camping_spots
   SET travel_styles = '{"winter": {"value": "yes", "source": "osm:opening_hours=24/7"}}'::jsonb
 WHERE region = 'Borovnica' AND missing_since IS NULL;

INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, cylinder_swap) VALUES ('n-winter-adria-water', 'water', NULL, (SELECT ST_Project(location::geography, 3000, pi())::geometry FROM camping_spots WHERE region = 'Zadarska' AND slug = 'adria' AND missing_since IS NULL), 'hr', 'unknown');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, cylinder_swap) VALUES ('n-winter-adria-dump', 'dump', NULL, (SELECT ST_Project(location::geography, 9900, pi())::geometry FROM camping_spots WHERE region = 'Zadarska' AND slug = 'adria' AND missing_since IS NULL), 'hr', 'unknown');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, cylinder_swap) VALUES ('n-winter-adria-gas', 'groceries', NULL, (SELECT ST_Project(location::geography, 10100, pi() * 5 / 4)::geometry FROM camping_spots WHERE region = 'Zadarska' AND slug = 'adria' AND missing_since IS NULL), 'hr', 'yes');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, cylinder_swap) VALUES ('n-winter-borovnica-dump', 'dump', NULL, (SELECT ST_Project(location::geography, 2000, pi())::geometry FROM camping_spots WHERE region = 'Borovnica' AND missing_since IS NULL), 'si', 'unknown');

DO $$
DECLARE
  n int;
BEGIN
  -- Exactly two sourced yes and one sourced no: an UPDATE that matched no row
  -- would leave the winter page empty and every test of it a pass over nothing.
  SELECT count(*) INTO n FROM camping_spots
   WHERE missing_since IS NULL AND travel_styles -> 'winter' ->> 'value' = 'yes';
  IF n <> 2 THEN
    RAISE EXCEPTION 'CI fixture: expected 2 winter-open campsites, got %', n;
  END IF;
  SELECT count(*) INTO n FROM camping_spots
   WHERE missing_since IS NULL AND travel_styles -> 'winter' ->> 'value' = 'no';
  IF n <> 1 THEN
    RAISE EXCEPTION 'CI fixture: expected 1 campsite recorded closed in winter, got %', n;
  END IF;
  SELECT count(*) INTO n FROM osm_route_poi WHERE osm_ref LIKE 'n-winter-%';
  IF n <> 4 THEN
    RAISE EXCEPTION 'CI fixture: expected 4 winter service points, got %', n;
  END IF;
  -- None of them is within 25 km of a curated route stage (see above).
  SELECT count(*) INTO n
    FROM osm_route_poi p JOIN route_points s
      ON ST_DWithin(p.location::geography, s.location::geography, 25000)
   WHERE p.osm_ref LIKE 'n-winter-%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'CI fixture: % winter service point(s) sit within 25 km of a route stage', n;
  END IF;
  RAISE NOTICE 'CI fixture: 2 winter-open campsites, 1 recorded closed, 4 service points';
END $$;
