
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

-- CAMP-101: give the seeded rows the source attribution real rows carry.
--
-- 🔴 The migration backfills `sources` for rows that exist WHEN IT RUNS.
-- In CI the order is migrate → seed, so every seeded campsite arrived
-- afterwards with `sources = '[]'` — and the attribution block, which is
-- a licence condition, rendered on no page at all. The e2e caught it
-- with "no campsite carries an OpenStreetMap source", which is exactly
-- what that test is for.
--
-- Same shape the OSM import writes: the date is when we last SAW the
-- campsite in OpenStreetMap, never when a mapper last edited it.
UPDATE camping_spots
   SET sources = jsonb_build_array(jsonb_build_object(
         'id', 'osm',
         'ref', osm_ref,
         'updatedAt', to_char(COALESCE(last_seen_at, created_at), 'YYYY-MM-DD'),
         'fields', '["name","location","amenities"]'::jsonb))
 WHERE osm_ref IS NOT NULL
   AND sources = '[]'::jsonb;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM camping_spots WHERE sources <> '[]'::jsonb;
  IF n = 0 THEN
    RAISE EXCEPTION
      'CI fixture: no campsite carries a source. The attribution block is '
      'a licence condition and would render on no page.';
  END IF;
  RAISE NOTICE 'CI fixture: % campsites carry a source', n;
END $$;

-- CAMP-144: one campsite that BOTH sources describe.
--
-- 🔴 Without this the fixture is all OpenStreetMap — 72 of 72 rows carry
-- an osm_ref — and the two CI steps this card adds pass by finding
-- nothing. "The reconciler wrote no rows" is true of a correct dry run
-- and equally true of a candidate query with a typo in its join, and
-- "every link invariant holds" is true of an empty table. That is the
-- same shape of blind check the block above this one exists to prevent.
--
-- So: a DATAtourisme-style row 60 m from a real campsite, carrying the
-- things only that source has (an official star rating, the operator's
-- own description) and lacking the things only OSM has. Exactly the pair
-- the card is about, which makes the dry run report a real candidate and
-- a real proposed link, and gives the import rehearsal a partner that
-- can legally be a secondary.
--
-- 🔴 Chosen by a rule and checked, never named — same discipline as the
-- gone block. The name must contain a word the matcher will not strip as
-- generic, or the two cores compare empty and nothing is proposed.
DO $$
DECLARE anchor record; n int;
BEGIN
  SELECT id, name, country, region, slug, location INTO anchor
    FROM camping_spots
   WHERE osm_ref IS NOT NULL
     AND region IS NOT NULL
     AND missing_since IS NULL
     AND name IS NOT NULL
     -- 🔴 A word the matcher will NOT strip as generic.
     --
     -- This used to be `name ~ '[A-Za-zÀ-ÿ]{5,}'`, which does not mean
     -- what its comment claimed: "Camping" is itself seven letters and
     -- matches it. An anchor called "Camping Village" would fold to an
     -- empty core on both sides, `decide` would return `review`, no link
     -- would be proposed — and every check would still pass, because
     -- they only asked whether a PAIR existed.
     --
     -- ⚠️ This list is a copy of the 5+ letter entries of GENERIC in
     -- datatourisme/match.ts. A copy can drift; the CI step that greps
     -- for a proposed link is what notices if it does.
     AND EXISTS (
       SELECT 1
         FROM regexp_split_to_table(lower(name), '[^a-zà-ÿ0-9]+') AS w
        WHERE length(w) >= 5
          AND w NOT IN ('camping', 'campings', 'campsite', 'caravaning',
                        'caravanning', 'carava', 'aires', 'residence',
                        'domaine', 'village', 'municipal', 'municipale',
                        'communal', 'communale', 'intercommunal')
     )
   ORDER BY slug
   LIMIT 1;

  IF anchor.id IS NULL THEN
    RAISE EXCEPTION
      'CI fixture: no campsite is suitable as a cross-source anchor, so '
      'the reconciler would be tested against a table it cannot match in.';
  END IF;

  INSERT INTO camping_spots
    (name, country, region, slug, type, amenities, location,
     description, description_lang, stars, website, sources, last_seen_at)
  VALUES (
    'Camping ' || anchor.name,
    anchor.country,
    anchor.region,
    anchor.slug || '-dt',
    'paid'::camping_spots_type_enum,
    -- Empty, not "unknown" for every key: France stores a literal '{}'
    -- and OSM stores explicit unknowns, and NOTHING_TO_SAY_SQL had to
    -- learn the difference. The fixture should carry both shapes.
    '{}'::jsonb,
    -- 🔴 60 m east, measured on the spheroid rather than by adding a
    -- degree. A fixed longitude offset is a different distance at every
    -- latitude, and this fixture is regenerated against whatever data is
    -- to hand — at 60°N the same offset would put the row outside the
    -- 150 m the matcher allows and the pair would quietly stop matching.
    ST_Project(anchor.location::geography, 60, radians(90))::geometry,
    'Camping familial au bord de l''eau, ouvert d''avril à octobre. '
      'Emplacements ombragés, piscine chauffée et accès direct au lac.',
    'fr',
    3,
    'https://example.invalid/camping-fixture',
    jsonb_build_array(jsonb_build_object(
      'id', 'datatourisme',
      'ref', 'https://data.datatourisme.fr/fixture/camp-144',
      'updatedAt', '2026-04-24',
      'fields', '["stars","description","name","website","location"]'::jsonb)),
    now());

  -- The pair must actually be a pair. If the anchor moved, or the
  -- projection changed, this fails here rather than in a CI step whose
  -- green means "found nothing".
  --
  -- 🔴 ST_DWithin first, exactly as the reconciler's own candidate query
  -- does it. Without the indexed bounding-box test this is a cartesian
  -- join: 73 rows in CI is nothing, but this file is also run by hand
  -- against the development database, where 61 558 rows make it 3.8
  -- billion comparisons and it never returns. Written after doing
  -- precisely that.
  SELECT count(*) INTO n
    FROM camping_spots a
    JOIN camping_spots b
      ON a.id < b.id
     AND ST_DWithin(a.location, b.location, 0.02)
     AND ST_DistanceSphere(a.location, b.location) <= 400
   WHERE (a.osm_ref IS NULL) <> (b.osm_ref IS NULL);

  IF n < 1 THEN
    RAISE EXCEPTION
      'CI fixture: the cross-source row is not within 400 m of an OSM '
      'row, so the reconciler has nothing to find.';
  END IF;

  RAISE NOTICE 'CI fixture: cross-source pair seeded against %', anchor.slug;
END $$;
