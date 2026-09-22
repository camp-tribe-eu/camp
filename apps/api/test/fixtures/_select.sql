-- Rows for the CI fixture. Chosen deliberately, never sampled: each block
-- exists because some test needs that state and would otherwise pass by
-- never running.
--
-- 🔴 The "paged" block is the one added last, and for the reason the
-- others exist too. Region pagination had code, had tests — and had never
-- been built once, because no region in the dataset held more than 24
-- campsites. The tests skipped, CI was green, and the first time anyone
-- would have seen a page 2 was in production.
WITH paged AS (
  -- One region large enough to paginate, capped so the fixture stays a
  -- fixture. 30 rows at 24 per page is exactly two pages: enough to prove
  -- the paginator, the canonical on page 2 and the link back.
  SELECT s.* FROM camping_spots s
   WHERE s.region = (
     SELECT region FROM camping_spots
      WHERE missing_since IS NULL AND region IS NOT NULL
      GROUP BY 1 HAVING count(*) >= 30
      -- Deterministic: the biggest, and the name breaks a tie. A fixture
      -- that changes which region it holds between regenerations is a
      -- fixture nobody can reason about.
      ORDER BY count(*) DESC, region LIMIT 1)
     AND s.missing_since IS NULL
   ORDER BY s.slug LIMIT 30),
big AS (
  -- Two ordinary regions above the indexing threshold and below one page,
  -- so "a region that fits on one page shows no paginator" still has a
  -- subject.
  SELECT region FROM camping_spots
   WHERE missing_since IS NULL AND region IS NOT NULL
   GROUP BY 1 HAVING count(*) >= 4 AND count(*) < 24
   ORDER BY count(*) DESC, region LIMIT 2),
thin AS (
  -- Below the indexing threshold: reachable, not indexed (CAMP-71).
  SELECT region FROM camping_spots
   WHERE missing_since IS NULL AND region IS NOT NULL
   GROUP BY 1 HAVING count(*) = 1 ORDER BY region LIMIT 3),
sanitary AS (
  -- CAMP-32: at least one campsite that says it has toilets and one that
  -- says it has none. The explicit NO is the rarer and more valuable of
  -- the two — it is the honest negative the three-state model exists for,
  -- and a fixture of only yes/unknown would never exercise it.
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND amenities->>'toilets' = 'yes' ORDER BY slug LIMIT 1)
  UNION ALL
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND amenities->>'toilets' = 'no' ORDER BY slug LIMIT 1)),
filterable AS (
  -- CAMP-35 / CAMP-25: a subject for each new filter, for the same reason
  -- the `sanitary` block above exists — a filter with nothing to match is
  -- a test that passes by finding zero and would go on passing after the
  -- filter broke.
  --
  -- 🔴 The third row is the important one. `wheelchair = yes` with
  -- `wheelchairFull = no` is a campsite OSM tags `wheelchair=limited`,
  -- and it is the only row that can tell the two accessibility filters
  -- apart. Without it both would return identical sets in CI and the
  -- whole argument for splitting them would be untested. Measured on the
  -- real data, 43 of 87 answered campsites are in exactly this state.
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND amenities->>'greyWater' = 'yes' ORDER BY slug LIMIT 1)
  UNION ALL
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND amenities->>'laundry' = 'yes' ORDER BY slug LIMIT 1)
  UNION ALL
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND amenities->>'wheelchair' = 'yes'
      AND amenities->>'wheelchairFull' = 'no' ORDER BY slug LIMIT 1)
  UNION ALL
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND amenities->>'wheelchairFull' = 'yes' ORDER BY slug LIMIT 1)
  UNION ALL
  -- Two types other than `paid`, so the type filter has something to
  -- include and something to exclude. 89% of the dataset is `paid`; a
  -- fixture that happened to hold only those would make every type
  -- filter look like it worked.
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND type = 'rv_park' ORDER BY slug LIMIT 1)
  UNION ALL
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND type = 'wild' ORDER BY slug LIMIT 1)),
surroundings AS (
  -- CAMP-33: the computed context is the project's one differentiator, so
  -- the fixture must hold both ends of it — a campsite where we know a
  -- lot, and one where we know nothing.
  --
  -- 🔴 Named explicitly rather than left to chance. It used to arrive by
  -- luck, because every region in the fixture happened to be Slovenian
  -- and computed. The moment a second country was imported, the regions
  -- the blocks above pick could all be ones whose context had not been
  -- computed yet, and the tests for "the nearest water is a real one"
  -- and "a site with no computed context still renders" would both have
  -- quietly stopped having a subject.
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND context->'water'->>'name' IS NOT NULL
      AND context->>'elevation' IS NOT NULL
    ORDER BY slug LIMIT 1)
  UNION ALL
  (SELECT * FROM camping_spots
    WHERE missing_since IS NULL AND region IS NOT NULL
      AND context = '{}'::jsonb
    ORDER BY slug LIMIT 1)),
picked AS (
  SELECT * FROM paged
  UNION SELECT * FROM sanitary
  UNION SELECT * FROM filterable
  UNION SELECT * FROM surroundings
  UNION SELECT * FROM camping_spots
   WHERE missing_since IS NULL AND region IS NOT NULL
     AND (region IN (SELECT region FROM big) OR region IN (SELECT region FROM thin)))
SELECT 'INSERT INTO camping_spots (id, name, country, region, slug, type, amenities, location, osm_ref, owner_overrides, last_seen_at, missing_since, created_at, context, content_changed_at) VALUES ('
  || quote_literal(id) || ', ' || coalesce(quote_literal(name),'NULL') || ', '
  || quote_literal(country) || ', ' || coalesce(quote_literal(region),'NULL') || ', '
  || quote_literal(slug) || ', ' || quote_literal(type::text) || '::camping_spots_type_enum, '
  || quote_literal(amenities::text) || '::jsonb, '
  || 'ST_GeomFromText(' || quote_literal(ST_AsText(location)) || ', 4326), '
  || quote_literal(osm_ref) || ', ' || quote_literal(owner_overrides::text) || '::jsonb, '
  || quote_literal(last_seen_at::text) || ', NULL, ' || quote_literal(created_at::text) || ', '
  || quote_literal(context::text) || '::jsonb, ' || quote_literal(content_changed_at::text) || ');'
FROM picked ORDER BY region, slug;
