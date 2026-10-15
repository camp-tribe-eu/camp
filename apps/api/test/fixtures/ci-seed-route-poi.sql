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
-- All six are in France, so `country` is 'fr' — the column is NOT NULL
-- (see the migration), because a NULL country is how 423 foreign rows
-- reached the live table.
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
-- 🔴 CAMP-119 added four more, and they are chosen the same way: real
-- objects from a real extract (south-west France, 25.09.2026, run through
-- the actual loader), each the nearest of its kind to a stage of this same
-- route, and between them they carry all three answers a facility can
-- give. Written with every facility column NAMED, so what the page says
-- is what this file says and not what a column DEFAULT happens to be.
--
--   rest_area     Bossioux  stage 1   all five 'unknown' — OSM says nothing
--   rest_area     Houmée    stage 2   toilets 'yes', the other four unknown
--   rest_area     La Rivière stage 3  toilets 'no', the other four unknown
--   service_area  Labenne   stage 6   toilets 'yes', with a phone AND a website
--
-- 🔴 Stage 3's `no` is the row that matters: a written no and a gap are
-- different words on the page, and a fixture with no `no` in it would
-- let a collapse of the one into the other pass.
--
-- Stage 2 has NO service area and stage 4 has no rest area, so the
-- "our database holds none within 25 km" line for the two new kinds is
-- still drawn — the same reason `dump` is absent above.

-- Real OpenStreetMap data, so the same attribution applies here as
-- everywhere: © OpenStreetMap contributors, ODbL.

INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours) VALUES ('n13570590317', 'charging', 'Arsenal', ST_GeomFromText('POINT(-1.1486001 46.1597128)', 4326), 'fr', NULL, NULL, '24/7');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours) VALUES ('n11001119446', 'food', 'Café de la Poste', ST_GeomFromText('POINT(-1.1519074 46.1599065)', 4326), 'fr', NULL, NULL, NULL);
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours) VALUES ('w718861647', 'fuel', 'station-service Leclerc', ST_GeomFromText('POINT(-1.1668489 46.173582)', 4326), 'fr', NULL, 'https://www.e.leclerc/mag/e-leclerc-lagord', '24/7');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours) VALUES ('n6724101564', 'groceries', 'Naturalia', ST_GeomFromText('POINT(-1.1498974 46.1625545)', 4326), 'fr', '+33 5 46 37 20 53', 'https://magasins.naturalia.fr/naturalia/fr/store/france/nouvelle-aquitaine/charente-maritime/la-rochelle/la-rochelle-minage/4015', 'Mo-Sa 09:00-20:00;Su 09:00-12:45');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours) VALUES ('n9063556553', 'shelter', 'Hôtel François 1er', ST_GeomFromText('POINT(-1.1518096 46.1607969)', 4326), 'fr', NULL, NULL, NULL);
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours) VALUES ('n14077709953', 'water', NULL, ST_GeomFromText('POINT(-1.1511579 46.1597392)', 4326), 'fr', NULL, NULL, NULL);
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours, toilets, shower, drinking_water, sanitary_dump_station, fee) VALUES ('w1297473548', 'rest_area', 'Aire de repos des Bossioux', ST_GeomFromText('POINT(-1.0814422 46.2421545)', 4326), 'fr', NULL, NULL, NULL, 'unknown', 'unknown', 'unknown', 'unknown', 'unknown');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours, toilets, shower, drinking_water, sanitary_dump_station, fee) VALUES ('n2338724489', 'rest_area', 'Aire d''Arrêt de l''Houmée', ST_GeomFromText('POINT(-0.9642309 45.8901206)', 4326), 'fr', NULL, NULL, NULL, 'yes', 'unknown', 'unknown', 'unknown', 'unknown');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours, toilets, shower, drinking_water, sanitary_dump_station, fee) VALUES ('n1015208210', 'rest_area', 'Aire d''Arrèt "La Rivière"', ST_GeomFromText('POINT(-0.9358625 45.6066858)', 4326), 'fr', NULL, NULL, NULL, 'no', 'unknown', 'unknown', 'unknown', 'unknown');
INSERT INTO osm_route_poi (osm_ref, kind, name, location, country, phone, website, opening_hours, toilets, shower, drinking_water, sanitary_dump_station, fee) VALUES ('w586855604', 'service_area', 'Aire de Labenne', ST_GeomFromText('POINT(-1.4188413 43.5859991)', 4326), 'fr', '+33 5 59 45 47 78', 'https://www.aires-autoroute-areas.com/autoroutes/a63/aire-labenne-est', NULL, 'yes', 'unknown', 'unknown', 'unknown', 'unknown');
