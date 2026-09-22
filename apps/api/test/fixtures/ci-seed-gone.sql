
-- CAMP-73: one campsite that OpenStreetMap has dropped for good.
--
-- 🔴 Added as an UPDATE on a row above rather than as another INSERT, so
-- regenerating the fixture from the dev database cannot silently drop
-- it. regenerate.sh appends this file every time.
--
-- Why the fixture needs it at all: without a gone campsite the whole
-- 410 path — the generated list, the middleware, the page that names the
-- campsite — builds, deploys and is never once executed. Every test of
-- it would pass by never running, which is the failure mode this project
-- keeps meeting.
--
-- 40 days: the import runs weekly and CAMP-87 declares an object gone
-- only after four consecutive imports without it, so the threshold is 28
-- days. 40 is comfortably past it and not so far as to look arbitrary.
UPDATE camping_spots
   SET missing_since = now() - interval '40 days'
 WHERE slug = 'prijon-sport-center';
