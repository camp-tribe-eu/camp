
-- CAMP-73: one campsite that OpenStreetMap has dropped for good.
--
-- 🔴 Chosen by a rule and checked, never named.
--
-- This block used to say `WHERE slug = 'prijon-sport-center'`. That
-- worked only as long as the fixture happened to contain that campsite:
-- regenerate it against a different dataset, the slug is not there, the
-- UPDATE matches zero rows, and the entire 410 path — generated list,
-- middleware, the page that names the campsite — builds, deploys and is
-- never executed. Every test of it would pass by skipping. That is the
-- exact failure this file exists to prevent, sitting inside the fix.
--
-- So: pick deterministically, and fail loudly if nothing was marked.
--
-- 40 days: the import runs weekly and CAMP-87 declares an object gone
-- only after four consecutive imports without it, so the threshold is 28
-- days. 40 is comfortably past it and not so far as to look arbitrary.
DO $$
DECLARE target text; n int;
BEGIN
  SELECT slug INTO target
    FROM camping_spots
   WHERE region IS NOT NULL
     -- Leave the rows the other blocks put here on purpose: the two that
     -- carry an explicit toilets answer, and the one with computed
     -- surroundings. A fixture whose guarantees eat each other is worse
     -- than one that guarantees less.
     AND coalesce(amenities->>'toilets', 'unknown') = 'unknown'
     AND context = '{}'::jsonb
   ORDER BY slug DESC
   LIMIT 1;

  UPDATE camping_spots
     SET missing_since = now() - interval '40 days'
   WHERE slug = target;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION
      'CI fixture: expected to mark exactly one campsite gone, marked %. '
      'Without one, every test of the 410 path silently skips.', n;
  END IF;

  RAISE NOTICE 'CI fixture: % marked gone', target;
END $$;
