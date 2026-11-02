-- CAMP-190: webcams for the CI fixture.
--
-- 🔴 A SEPARATE FILE, APPENDED BY regenerate.sh, AND NOT PART OF
-- `_select.sql` — because these rows are not drawn from the production
-- database. The webcam catalogue is imported by
-- `scripts/windy/fetch-webcams.mjs` and the table is empty until it has
-- run, so a regeneration would produce nothing and the fixture would
-- lose the panel entirely.
--
-- I first appended this block to `ci-seed.sql` by hand, which is exactly
-- what the `--check` guard exists to refuse: the generated file would
-- then hold a table the generator cannot produce, and the next
-- regeneration would silently drop it. CI caught it — the failing step
-- was "Every table the fixture seeds is still produced by its
-- generator", not the `pgPass` noise I chased twice.
-- `spots.service.ts` answers `webcams: null` while this table is empty —
-- "we have not imported the catalogue" — and the panel then renders
-- NOTHING, which is the honest thing to do on a site that has not
-- looked. The cost is that in CI the webcam section is in no built page
-- at all, so every test about it passes over a panel that does not
-- exist. Review proved it: changing the panel's heading from h2 to h3
-- left all 814 unit tests green and the new outline rule silent,
-- because there was no heading to judge.
--
-- So the fixture carries three rows, each chosen for a branch the page
-- has to get right:
--
--   bovec-live     9 minutes old, 465 m from `camp-bovec` → the cards
--   bovec-operator 41 minutes old, 1.4 km away, no provider_url → the
--                  "operator's own site" line must NOT appear for it
--   zadar-dead     three days old, 60 m from `adria` in Zadarska and
--                  ~280 km from the other two → filtered by
--                  CAMERA_DEAD_AFTER_MINUTES, so the campsites around
--                  it show "none of them has reported" rather than the
--                  coverage sentence
--
-- 🔴 THE DISTANCES ARE THE POINT, AND I GOT THEM WRONG FIRST. The dead
-- camera was placed near `camp-rut`, 433 m away — but `camp-rut` is
-- also 10.6 km from the two live ones, well inside the 25 km radius, so
-- it would have rendered cards and the stale branch would have had no
-- subject anywhere in the fixture. Measured, all three against every
-- site, before writing this down. Zadarska is ~280 km from Bovec, which
-- is what makes the dead camera alone there.
--
-- Between them the three rows give all four states a page can be in:
-- cards (SI), "our reading is old" (Zadarska near `adria`), "no camera
-- within 25 km" (every other HR campsite), and — with the table
-- emptied — no panel at all.
--
-- Times are relative to load, not literals: a fixture that goes stale
-- on its own turns a real assertion into a flake, and this one is ABOUT
-- staleness.
--
-- 🔴 Titles carry no reserved word (`webcams_title_sayable` refuses
-- warning/danger/risk/alert/evacuate), every url is https, and the
-- country is two capitals — each of those is a CHECK, and a row that
-- violated one would fail the load loudly rather than quietly skew a
-- count.
INSERT INTO webcams (provider, ref, title, country, categories, location, detail_url, provider_url, last_frame_at) VALUES
  ('windy', '1690466401', 'Bovec: Live webcam - airport - View to Kanin', 'SI', '{mountain}',
   ST_GeomFromText('POINT(13.5520 46.3390)', 4326)::geography,
   'https://windy.com/webcams/1690466401',
   'https://www.whatsupcams.com/en/webcams/Slovenia/Goriska/Bovec/live-webcam-bovec-airport',
   now() - interval '9 minutes'),
  ('windy', '1689851105', 'Bovec', 'SI', '{mountain}',
   ST_GeomFromText('POINT(13.5660 46.3440)', 4326)::geography,
   'https://windy.com/webcams/1689851105', NULL,
   now() - interval '41 minutes'),
  ('windy', '1611140235', 'Zadar: harbour', 'HR', '{harbor}',
   ST_GeomFromText('POINT(15.4355 43.9550)', 4326)::geography,
   'https://windy.com/webcams/1611140235', NULL,
   now() - interval '3 days');

DO $$
DECLARE n int;
BEGIN
  -- The load must fail loudly if a CHECK silently dropped a row, or if
  -- somebody regenerates this file and leaves the table empty again:
  -- an empty table is exactly the state that blinded the guard.
  SELECT count(*) INTO n FROM webcams;
  IF n <> 3 THEN
    RAISE EXCEPTION 'CI fixture: expected 3 webcams, got %', n;
  END IF;
  SELECT count(*) INTO n FROM webcams WHERE last_frame_at < now() - interval '1 day';
  IF n <> 1 THEN
    RAISE EXCEPTION 'CI fixture: expected exactly 1 camera older than a day, got %', n;
  END IF;
  RAISE NOTICE 'CI fixture: 3 webcams seeded, 1 of them past the freshness line';
END $$;
