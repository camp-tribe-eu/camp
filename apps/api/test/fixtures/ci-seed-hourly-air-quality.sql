-- CAMP-164: air quality for the CI fixture.
--
-- 🔴 A SEPARATE FILE, APPENDED BY regenerate.sh, AND NOT PART OF
-- _select.sql — and the reason is the one this fixture's other appended
-- files give, plus one of its own.
--
-- The development database will hold 4 018 stations and their newest
-- reported hour, and a fixture SELECTED from it would be wrong twice:
-- every timestamp in it would be a fortnight old by the time CI reads it,
-- so every page would render "no fresh data" and the tests for a fresh
-- reading would have no subject; and the states the page must render —
-- a silent station, a model that has aged out, a station 20.5 km away —
-- are not states a sample of the real table reliably contains. So these
-- rows are DESIGNED, positioned relative to the campsites that are in the
-- fixture, and every time in them is relative to now(), which is when
-- psql runs this: CI seeds and builds in one job.
--
-- 🔴 SYNTHETIC, AND SAID SO. Every station here is called "CI fixture
-- station …" and its code begins FIXTURE. Nothing below is EEA data and
-- nothing in it may be quoted as if it were; the real thing is
-- src/air/import.ts. (The names are what tests/e2e/air-quality.spec.ts
-- finds the pages by, so they are the one part that must not be reworded
-- without changing the spec.)
--
-- 🔴 SORTS AFTER ci-seed-gone.sql, ON PURPOSE. That file marks one
-- campsite as dropped by OpenStreetMap. If this ran first it could pick
-- that campsite for a station, and the page every air-quality assertion
-- was written against would answer 410. Here the dropped campsite is
-- already gone and `missing_since IS NULL` skips it.
--
-- 🔴 CHOSEN BY A RULE AND CHECKED, NEVER NAMED (the same discipline as
-- the campsite the gone block marks). The seven stations go beside the
-- first seven live campsites, in slug order, that are more than 60 km
-- from every earlier pick. 60 km is not arbitrary: a station is placed
-- at most 20.5 km from its campsite and the radius is 20 km, so two
-- picks 60 km apart cannot see each other's station (39.5 km > 20 km).
-- If the fixture ever holds fewer than seven such campsites this block
-- raises, and CI stops at the seed instead of building a site that
-- quietly cannot exercise a state.
--
--   station  from its campsite  what it holds                     the page says
--   1        3.2 km   background   PM10 + NO2, reported, 2 h old   reported, Fair
--   2        5.4 km   traffic      NO2 MODELLED and setting the    partly modelled,
--                                  level, PM10 reported, 2 h old   Moderate
--   3        8.0 km   background   NO READING                      no fresh data
--   4        6.1 km   industrial   a reading 30 h old              no fresh data
--   5       19.5 km   background   PM2.5 + PM10, reported, 1 h     reported, Good
--                                                                  (INSIDE the radius)
--   6       20.5 km   background   PM10 + NO2, reported, 2 h       NOT SHOWN: the campsite
--                                                                  gets the model instead
--                                                                  (OUTSIDE the radius)
--   7        4.0 km   industrial   NO2 + O3 only, reported, 1 h    reported, and says the
--                                                                  index has no particulates
--
-- Then the 1 km model, for the campsite beside station 6 and for the
-- first two other campsites (slug order) with no station within 20 km:
--
--   beside station 6   Moderate (level 3), this hour      modelled estimate
--   first of the two   Good (level 1), this hour          modelled estimate
--   second of the two  level 2, 30 h old                  no fresh data (model)
--
-- Every other campsite has neither, and renders "No air-quality data".
--
-- All readings are at most 2 h old at seed time and the budget is 4 h, so
-- a job that takes an hour to get from here to its tests still finds them
-- fresh; the 30 h ones are stale for as long as anyone runs this.
DO $$
DECLARE
  spot          record;
  picked        geography[] := '{}';
  n             int := 0;
  m             int := 0;
  hr            timestamptz := date_trunc('hour', now());
  pick6         uuid;
  radius_m      constant int := 20000;
  offset_m      int[]  := ARRAY[3200, 5400, 8000, 6100, 19500, 20500, 4000];
  names         text[] := ARRAY[
    'CI fixture station 1 (reported)',
    'CI fixture station 2 (partly modelled)',
    'CI fixture station 3 (silent)',
    'CI fixture station 4 (stale)',
    'CI fixture station 5 (19.5 km)',
    'CI fixture station 6 (20.5 km)',
    'CI fixture station 7 (no particulate matter)'];
  kinds         text[] := ARRAY['background', 'traffic', 'background', 'industrial', 'background', 'background', 'industrial'];
  hours_ago     int[]  := ARRAY[2, 2, NULL, 30, 1, 2, 1];
  idx           numeric[] := ARRAY[2.2, 3.4, NULL, 2.2, 1.6, 2.2, 2.4];
  bands         int[]  := ARRAY[2, 3, NULL, 2, 1, 2, 2];
  bases         text[] := ARRAY['reported', 'mixed', NULL, 'reported', 'reported', 'reported', 'reported'];
  culprits      text[] := ARRAY['PM10', 'NO2', NULL, 'PM10', 'PM10', 'PM10', 'O3'];
  polls         text[] := ARRAY[
    '[{"pollutant":"PM10","band":2,"value":23,"modelled":false},{"pollutant":"NO2","band":1,"value":14,"modelled":false}]',
    '[{"pollutant":"PM10","band":2,"value":23,"modelled":false},{"pollutant":"NO2","band":3,"value":40,"modelled":true}]',
    NULL,
    '[{"pollutant":"PM10","band":2,"value":23,"modelled":false},{"pollutant":"NO2","band":1,"value":14,"modelled":false}]',
    '[{"pollutant":"PM2.5","band":1,"value":4,"modelled":false},{"pollutant":"PM10","band":1,"value":9,"modelled":false}]',
    '[{"pollutant":"PM10","band":2,"value":23,"modelled":false},{"pollutant":"NO2","band":1,"value":14,"modelled":false}]',
    '[{"pollutant":"NO2","band":1,"value":8,"modelled":false},{"pollutant":"O3","band":2,"value":70,"modelled":false}]'];
BEGIN
  FOR spot IN
    SELECT s.id, s.country, s.location::geography AS g
      FROM camping_spots s
     WHERE s.missing_since IS NULL
       AND s.region IS NOT NULL
       -- A secondary is hidden behind its primary (CAMP-144) and its URL
       -- redirects; a station beside it would be beside no page.
       AND NOT EXISTS (SELECT 1 FROM spot_links l
                        WHERE l.secondary_id = s.id AND l.unlinked_at IS NULL)
     ORDER BY s.slug
  LOOP
    EXIT WHEN n = 7;
    CONTINUE WHEN EXISTS (SELECT 1 FROM unnest(picked) p WHERE ST_DWithin(p, spot.g, 60000));

    n := n + 1;
    picked := picked || spot.g;
    IF n = 6 THEN pick6 := spot.id; END IF;

    INSERT INTO air_quality_stations
      (code, name, municipality, country, station_type, area_classification,
       location, roster_file,
       reading_hour, reading_index, reading_band, reading_basis,
       reading_culprit, reading_pollutants, read_at)
    VALUES
      ('FIXTURE' || n, names[n], NULL, lower(spot.country), kinds[n], 'Urban',
       ST_Project(spot.g, offset_m[n], radians(90))::geography,
       'ci-fixture',
       CASE WHEN hours_ago[n] IS NULL THEN NULL ELSE hr - hours_ago[n] * interval '1 hour' END,
       idx[n], bands[n], bases[n], culprits[n], polls[n]::jsonb,
       now());
  END LOOP;

  IF n < 7 THEN
    RAISE EXCEPTION 'CAMP-164 fixture: only % live campsites more than 60 km apart, need 7 — '
                    'the air quality states cannot all be exercised', n;
  END IF;

  -- The model: beside station 6 first, so that "20.5 km is outside the
  -- radius" has a page that shows what happens instead.
  INSERT INTO air_quality_modelled (spot_id, hour, band, read_at)
  VALUES (pick6, hr, 3, now());

  FOR spot IN
    SELECT s.id
      FROM camping_spots s
     WHERE s.missing_since IS NULL
       AND s.region IS NOT NULL
       AND s.id <> pick6
       AND NOT EXISTS (SELECT 1 FROM spot_links l
                        WHERE l.secondary_id = s.id AND l.unlinked_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM air_quality_stations st
                        WHERE ST_DWithin(s.location::geography, st.location, radius_m))
     ORDER BY s.slug
  LOOP
    m := m + 1;
    INSERT INTO air_quality_modelled (spot_id, hour, band, read_at)
    VALUES (spot.id,
            CASE m WHEN 1 THEN hr ELSE hr - interval '30 hours' END,
            CASE m WHEN 1 THEN 1 ELSE 2 END,
            now());
    EXIT WHEN m = 2;
  END LOOP;

  IF m < 2 THEN
    RAISE EXCEPTION 'CAMP-164 fixture: only % campsites with no station within 20 km, need 2 — '
                    'the model states cannot all be exercised', m;
  END IF;
END
$$;
