WITH big AS (
  SELECT region FROM camping_spots WHERE missing_since IS NULL AND region IS NOT NULL
   GROUP BY 1 HAVING count(*) >= 4 ORDER BY count(*) DESC LIMIT 2),
thin AS (
  SELECT region FROM camping_spots WHERE missing_since IS NULL AND region IS NOT NULL
   GROUP BY 1 HAVING count(*) = 1 LIMIT 3),
picked AS (
  SELECT * FROM camping_spots WHERE missing_since IS NULL AND region IS NOT NULL
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
