-- CAMP-427: прокатні компанії для фікстури CI.
--
-- 🔴 ОКРЕМИЙ ФАЙЛ, ЯКИЙ regenerate.sh ДОДАЄ, І НЕ ЧАСТИНА `_select.sql` —
-- з тієї самої причини, що й вебкамери: ці рядки не беруться з
-- продакшн-бази. Каталог кладе `scripts/rental/seed-providers.mjs` із
-- файлів у репозиторії, і в базі розробника таблиці можуть бути порожні.
--
-- 🔴 І ОСЬ ЩО ЦЕЙ ФАЙЛ ЗАКРИВАЄ, ЗАМІРЯНО 03.11.2026.
--
--   grep -c "rental_provider" apps/api/test/fixtures/ci-seed.sql  →  0
--
-- Тобто в CI каталог компаній рендерився з ПОРОЖНІМ переліком, а
-- `generateStaticParams` будував НУЛЬ сторінок-синглів. Сторінка однієї
-- компанії не існувала в жодній збірці CI: падіння на ній пройшло б усі
-- перевірки й поїхало б у прод. Це той самий клас, що й вебкамери, де
-- заміна h2 на h3 лишила 814 тестів зеленими, бо заголовка не було.
--
-- Чотири компанії, і кожна обрана під гілку, яку сторінка мусить узяти
-- правильно:
--
--   alpenwohnmobil  AT+DE, повний набір: контакти, парк, профіль відгуків
--   norracamper     SE, мінімум — ні сайту, ні пошти, ні телефону, ні
--                   парку: сторінка мусить віддати її без порожніх рядків
--   lagocampers     IT+AT, має сервіс `unavailable` — його не можна
--                   показати ні в розмітці, ні як «є»
--   dunesvans       NL+DE+BE, три країни: без неї «вибір країни звужує»
--                   не можна довести, бо звужувати не буде що
--
-- 🔴 Перетин країн навмисний: AT є в двох компаній, DE у двох. Якби
-- кожна країна була рівно в однієї, фільтр за країною завжди давав би
-- рівно один рядок, і тест не відрізнив би «звужує» від «показує лише
-- першу».
--
-- Рейтингів тут немає й бути не може: замок у схемі
-- (`..._figures_need_permission`) не дасть покласти цифру без
-- `permission_confirmed_on`, а дозволу від Trustpilot ми не маємо.
-- Профіль — це посилання, і більше нічого.

INSERT INTO rental_providers
  (id, slug, name, legal_name, registration_number, home_country, website, email, phone,
   declared_depot_count, declared_fleet_size, founded_year, source_url, source_checked_on, status)
VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001', 'alpenwohnmobil', 'Alpenwohnmobil',
   'Alpenwohnmobil GmbH', 'FN 123456a', 'AT', 'https://alpenwohnmobil.example',
   'hallo@alpenwohnmobil.example', '+43 1 234 5678', 6, 140, 1998,
   'https://alpenwohnmobil.example/about', '2026-11-03', 'published'),
  ('aaaaaaa1-0000-4000-8000-000000000002', 'norracamper', 'Norra Camper',
   NULL, NULL, 'SE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'published'),
  ('aaaaaaa1-0000-4000-8000-000000000003', 'lagocampers', 'Lago Campers',
   'Lago Campers S.r.l.', 'IT09876543', 'IT', 'https://lagocampers.example',
   'ciao@lagocampers.example', NULL, 2, 35, 2014,
   'https://lagocampers.example/chi-siamo', '2026-11-03', 'published'),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'dunesvans', 'Dunes Vans',
   'Dunes Vans B.V.', 'NL55667788', 'NL', 'https://dunesvans.example',
   NULL, '+31 20 000 0000', 9, 210, 2007,
   'https://dunesvans.example/over-ons', '2026-11-03', 'published');

INSERT INTO rental_provider_translations (provider_id, language_code, intro, what_to_know) VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001', 'en',
   'An Austrian company handing over motorhomes at six depots across the Alps and southern Germany.',
   'Winter tyres are fitted from October to April on every vehicle.'),
  ('aaaaaaa1-0000-4000-8000-000000000002', 'en',
   'A small Swedish operator working from a single yard outside Gothenburg.',
   NULL),
  ('aaaaaaa1-0000-4000-8000-000000000003', 'en',
   'An Italian company renting compact campervans around the northern lakes.',
   NULL),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'en',
   'A Dutch company with depots in the Netherlands, Germany and Belgium.',
   'One-way hire between its own depots is possible on request.');

INSERT INTO rental_provider_countries (provider_id, country, source_url, source_checked_on) VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001', 'AT', 'https://alpenwohnmobil.example/depots', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000001', 'DE', 'https://alpenwohnmobil.example/depots', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000002', 'SE', NULL, NULL),
  ('aaaaaaa1-0000-4000-8000-000000000003', 'IT', 'https://lagocampers.example/sedi', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000003', 'AT', 'https://lagocampers.example/sedi', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'NL', 'https://dunesvans.example/depots', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'DE', 'https://dunesvans.example/depots', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'BE', 'https://dunesvans.example/depots', '2026-11-03');

INSERT INTO rental_provider_services (provider_id, code, availability, note, source_url, source_checked_on) VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001', 'unlimited_km', 'included', NULL, 'https://alpenwohnmobil.example/terms', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000001', 'winter_tyres', 'included', NULL, 'https://alpenwohnmobil.example/terms', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000001', 'bike_rack', 'extra', NULL, 'https://alpenwohnmobil.example/terms', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000002', 'bedding', 'extra', NULL, NULL, NULL),
  ('aaaaaaa1-0000-4000-8000-000000000003', 'unlimited_km', 'extra', NULL, 'https://lagocampers.example/condizioni', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000003', 'one_way', 'unavailable', NULL, 'https://lagocampers.example/condizioni', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'unlimited_km', 'included', NULL, 'https://dunesvans.example/voorwaarden', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'one_way', 'extra', NULL, 'https://dunesvans.example/voorwaarden', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'pets_allowed', 'included', NULL, 'https://dunesvans.example/voorwaarden', '2026-11-03');

INSERT INTO rental_provider_vehicles (provider_id, name, slug, berths, belted_seats, length_cm, source_url, source_checked_on) VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001', 'Alpine 600', 'alpine-600', 4, 4, 599, 'https://alpenwohnmobil.example/fleet', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000001', 'Alpine 740', 'alpine-740', 6, 6, 741, 'https://alpenwohnmobil.example/fleet', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000003', 'Lago Compact', 'lago-compact', 2, 4, 540, 'https://lagocampers.example/flotta', '2026-11-03'),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'Dune Van 6', 'dune-van-6', 4, NULL, 636, 'https://dunesvans.example/vloot', '2026-11-03');

-- 🔴 Лише посилання. `rating` і `review_count` лишаються NULL, і замок у
-- схемі не дасть їх покласти, доки немає письмового дозволу.
INSERT INTO rental_provider_review_profiles (provider_id, source, profile_url) VALUES
  ('aaaaaaa1-0000-4000-8000-000000000001', 'trustpilot', 'https://www.trustpilot.com/review/alpenwohnmobil.example'),
  ('aaaaaaa1-0000-4000-8000-000000000004', 'trustpilot', 'https://www.trustpilot.com/review/dunesvans.example');

-- 🔴 Фікстура доводить себе сама, як і вебкамери: порожній або врізаний
-- засів інакше виглядав би як «каталог просто не має цих компаній», і
-- кожен тест нижче проходив би над списком, якого немає.
DO $$
DECLARE p int; c int; s int; v int; cc int;
BEGIN
  SELECT count(*) INTO p FROM rental_providers WHERE slug IN
    ('alpenwohnmobil','norracamper','lagocampers','dunesvans');
  SELECT count(*) INTO c FROM rental_provider_countries;
  SELECT count(DISTINCT country) INTO cc FROM rental_provider_countries;
  SELECT count(*) INTO s FROM rental_provider_services;
  SELECT count(*) INTO v FROM rental_provider_vehicles;
  IF p <> 4 THEN
    RAISE EXCEPTION 'CI fixture: expected 4 rental providers, got %', p;
  END IF;
  -- Країн більше, ніж компаній, і жодна країна не в однієї компанії
  -- самотньо — інакше фільтр за країною не можна відрізнити від «показує
  -- лише першу».
  IF cc < 5 OR c <= cc THEN
    RAISE EXCEPTION 'CI fixture: % country rows over % distinct countries — фільтр нічим звужувати', c, cc;
  END IF;
  IF s < 8 OR v < 3 THEN
    RAISE EXCEPTION 'CI fixture: % services, % vehicles — замало на гілки сторінки', s, v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rental_provider_services WHERE availability = 'unavailable') THEN
    RAISE EXCEPTION 'CI fixture: немає жодного сервісу зі станом unavailable — гілку «не показувати» нічим перевірити';
  END IF;
  IF EXISTS (SELECT 1 FROM rental_provider_review_profiles WHERE rating IS NOT NULL OR review_count IS NOT NULL) THEN
    RAISE EXCEPTION 'CI fixture: у профілі відгуків стоїть цифра — дозволу на це немає';
  END IF;
  RAISE NOTICE 'CI fixture: % rental providers, % country rows over % countries, % services, % vehicles', p, c, cc, s, v;
END $$;
