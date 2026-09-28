-- CAMP-113: route services for the CI fixture.
--
-- 🔴 A SEPARATE FILE, APPENDED BY regenerate.sh, AND NOT PART OF
-- _select.sql.
--
-- ci-seed.sql is regenerated from whatever the dev database holds, and
-- the dev database holds 2.26 million of these. Selecting them the way
-- the campsites are selected would either dump the table into the
-- fixture or, with a LIMIT, pick rows that are nowhere near a route
-- stage — and a fixture whose rows are nowhere near a stage makes the
-- services block render "we hold none" seven times on every page, which
-- is a PASSING test over nothing. That is the CAMP-134 failure exactly.
--
-- So these six are chosen, not sampled: they are the real nearest
-- objects to the first stage of the France Atlantic Coast route
-- (La Rochelle, 46.1603/-1.1511), and between them they exercise every
-- branch the page has.
--
--   fuel       named, 24/7 hours, a website, no phone
--   groceries  named, hours, a phone AND a website — the full row
--   charging   named, 24/7, nothing else
--   food       named and NOTHING else — three "unknown" labels in a row
--   shelter    named, nothing else
--   water      UNNAMED — the "Unnamed drinking water" path, which is the
--              usual case in the real data (65 of 67 published stages)
--
-- 🔴 And `dump` is deliberately ABSENT, so that every route page in CI
-- renders the "our database holds no chemical-toilet disposal point
-- within 25 km" line. That branch is 16 of the 67 real stages and it is
-- the one a refactor would quietly drop.
--
-- Real OpenStreetMap data, so the same attribution applies here as
-- everywhere: © OpenStreetMap contributors, ODbL.

INSERT INTO osm_route_poi (osm_ref, kind, name, location, phone, website, opening_hours) VALUES ('n13570590317', 'charging', 'Arsenal', ST_GeomFromText('POINT(-1.1486001 46.1597128)', 4326), NULL, NULL, '24/7');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, phone, website, opening_hours) VALUES ('n11001119446', 'food', 'Café de la Poste', ST_GeomFromText('POINT(-1.1519074 46.1599065)', 4326), NULL, NULL, NULL);
INSERT INTO osm_route_poi (osm_ref, kind, name, location, phone, website, opening_hours) VALUES ('w718861647', 'fuel', 'station-service Leclerc', ST_GeomFromText('POINT(-1.1668489 46.173582)', 4326), NULL, 'https://www.e.leclerc/mag/e-leclerc-lagord', '24/7');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, phone, website, opening_hours) VALUES ('n6724101564', 'groceries', 'Naturalia', ST_GeomFromText('POINT(-1.1498974 46.1625545)', 4326), '+33 5 46 37 20 53', 'https://magasins.naturalia.fr/naturalia/fr/store/france/nouvelle-aquitaine/charente-maritime/la-rochelle/la-rochelle-minage/4015', 'Mo-Sa 09:00-20:00;Su 09:00-12:45');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, phone, website, opening_hours) VALUES ('n9063556553', 'shelter', 'Hôtel François 1er', ST_GeomFromText('POINT(-1.1518096 46.1607969)', 4326), NULL, NULL, NULL);
INSERT INTO osm_route_poi (osm_ref, kind, name, location, phone, website, opening_hours) VALUES ('n14077709953', 'water', NULL, ST_GeomFromText('POINT(-1.1511579 46.1597392)', 4326), NULL, NULL, NULL);
