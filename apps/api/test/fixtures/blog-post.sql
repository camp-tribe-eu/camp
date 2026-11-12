-- CAMP-364: один допис блогу, ЛИШЕ для фікстури CI.
--
-- 🔴 ЧОМУ НЕ МІГРАЦІЯ. Блог у проді має вийти порожнім: редакційний
-- текст — голос власника, і вигадувати перший допис за нього я не буду.
-- Але сторінка допису без жодного допису не перевіряється нічим, а
-- `generateStaticParams` на порожньому переліку не згенерує жодної
-- адреси — тобто головна фіча PR лишилась би непокритою.
--
-- Тому допис живе тут: він є в CI і його немає в проді.
--
-- 🔴 І ФАЙЛ НЕ НАЗВАНО `ci-seed-*.sql` НАВМИСНО. Ті файли збирає
-- `regenerate.sh` у згенерований `ci-seed.sql`, і сторож
-- `check-fixture-not-shrunk.mjs` звіряє одне з одним. Цей рядок
-- генератору не належить: він не зліпок продакшну, а фікстура тесту.

BEGIN;

INSERT INTO pages (slug, type, status, published_at, author_name, noindex)
VALUES (
  'what-the-data-does-not-say',
  'post',
  'published',
  '2026-10-01T09:00:00Z',
  'CampTribe',
  false
);

INSERT INTO page_translations (page_id, language_code, title, meta_description)
SELECT id,
       'en',
       'What the data does not say',
       'A campsite record is never complete, and we show the gaps as gaps.'
  FROM pages
 WHERE slug = 'what-the-data-does-not-say' AND type = 'post';

INSERT INTO page_sections (page_id, sort, type, visible)
SELECT id, 0, 'prose', true
  FROM pages
 WHERE slug = 'what-the-data-does-not-say' AND type = 'post';

INSERT INTO page_section_translations (section_id, language_code, heading, body, items)
SELECT s.id,
       'en',
       NULL,
       'A campsite record is never complete. We publish what is recorded and leave the rest visibly empty.

## Why a gap beats a guess

A guess looks exactly like a fact once it is printed.',
       '[]'::jsonb
  FROM page_sections s
  JOIN pages p ON p.id = s.page_id
 WHERE p.slug = 'what-the-data-does-not-say' AND p.type = 'post';

-- 🔴 І ЩЕ ОДИН — МАЙБУТНЬОЮ ДАТОЮ. Він не сміє зʼявитись ні в блозі,
-- ні в карті сайту, ні як згенерована адреса. Без нього твердження
-- «запланований допис не видно» можна було б написати тільки над
-- порожнечею, а порожнеча задовольняє будь-яку заборону.
INSERT INTO pages (slug, type, status, published_at, author_name, noindex)
VALUES (
  'scheduled-and-not-yet-due',
  'post',
  'published',
  '2099-01-01T00:00:00Z',
  'CampTribe',
  false
);

INSERT INTO page_translations (page_id, language_code, title, meta_description)
SELECT id, 'en', 'Scheduled and not yet due', 'Must not be visible anywhere.'
  FROM pages
 WHERE slug = 'scheduled-and-not-yet-due' AND type = 'post';

-- 🔴 СТОРОЖ РАХУЄ ЛИШЕ СВОЇ ЗАПИСИ, А НЕ ВСІ ДОПИСИ В ТАБЛИЦІ. Раніше
-- тут стояло «рівно 2 допису в базі» — і воно впало, щойно міграція
-- `SeedTestBlogPosts` поклала власні п'ять. Жорстке число зламалося б
-- знову на шостому. Те, що фікстура мусить довести, — що ЇЇ два рядки
-- посаджено: один видимий, один із майбутньою датою. Чужі дописи тут
-- не заважають і не рятують: рахунок іде за слагами цього файлу.
DO $$
DECLARE n int;
DECLARE future int;
BEGIN
  SELECT count(*) INTO n FROM pages
   WHERE type = 'post'
     AND slug IN ('what-the-data-does-not-say', 'scheduled-and-not-yet-due');
  IF n <> 2 THEN
    RAISE EXCEPTION 'CI fixture: expected its own 2 posts, found %', n;
  END IF;
  SELECT count(*) INTO future FROM pages
   WHERE type = 'post' AND slug = 'scheduled-and-not-yet-due'
     AND published_at > now();
  IF future <> 1 THEN
    RAISE EXCEPTION 'CI fixture: the scheduled post is not dated in the future';
  END IF;
  RAISE NOTICE 'CI fixture: its own 2 posts seeded, 1 of them dated in the future';
END $$;

COMMIT;
