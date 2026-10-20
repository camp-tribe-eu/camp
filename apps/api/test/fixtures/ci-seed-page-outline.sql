
-- 🔴 CAMP-352: щонайменше один кемпінг фікстури має обрис ділянки.
--
-- ЖИВЕ САМЕ ТУТ, а не в `ci-seed.sql`. Той файл — ЗГЕНЕРОВАНИЙ артефакт:
-- `regenerate.sh` складає його як HEADER + вивід `_select.sql` + усі
-- `ci-seed-*.sql`. Я спершу дописав цей блок у згенерований файл, і
-- наступна перегенерація мовчки зітерла б і UPDATE, і його сторож — а
-- guard звіряє таблиці й рядки, тож зниклого statement не побачив би.
-- Попередження про цю саму пастку лежить у `_select.sql:13-18`, у файлі,
-- який я тоді ж і правив. Знайшла рецензія PR #292.
--
-- ЧОМУ ВЗАГАЛІ ПОТРІБНО. Без обрису хоч на одному рядку гілка «контур є»
-- (підпис, шари `site-outline-*`, кадрування) не виконується в браузері
-- жодного разу, а тест лишається зеленим, бо щоразу йде в гілку «немає».
--
-- Обрис будується ВІД ТОЧКИ самого рядка: міграція вимагає
-- `ST_DWithin(outline, location, 0.0001)`, і квадрат навколо власної
-- точки задовольняє це за побудовою. Вписані координати розійшлися б із
-- точкою першої ж перегенерації.
-- 🔴 ПРЕДИКАТ МУСИТЬ ЗБІГАТИСЯ З ІНДЕКСОМ, А НЕ БУТИ СХОЖИМ НА НЬОГО.
-- `/spots/index` відбирає ще й `NOT isSecondarySql(s)` — кемпінг, злитий
-- як вторинний у пару (CAMP-144/280), в індексі не зʼявляється. Перша
-- редакція цього UPDATE цієї умови не мала й збігалася з індексом лише
-- випадково: у фікстурі `spot_links` порожній. Щойно зʼявиться перший
-- лінк, обрис міг би дістатись рядку, якого e2e не бачить, — і тест
-- упав би з ХИБНОЮ назвою причини («гілка недосяжна» замість «рядок не
-- в індексі»). Знайшла рецензія PR #292.
UPDATE camping_spots
   SET outline = ST_Multi(ST_Envelope(ST_Buffer(location, 0.0005)))
 WHERE outline IS NULL
   AND id = (
     SELECT s.id FROM camping_spots s
      WHERE s.missing_since IS NULL
        AND s.region IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM spot_links l
            JOIN camping_spots lp ON lp.id = l.primary_id
           WHERE l.secondary_id = s.id
             AND l.unlinked_at IS NULL
             AND lp.missing_since IS NULL
             AND lp.region IS NOT NULL
        )
      ORDER BY s.country, s.region, s.slug
      LIMIT 1
   );

DO $$
DECLARE n int;
BEGIN
  -- 🔴 `>= 1`, а не `= 1`. Щойно `_select.sql` почне віддавати справжні
  -- обриси з прода, рядків стане більше — і рівність завалила б
  -- завантаження фікстури на рівному місці. Нам потрібне «хоч один», бо
  -- саме це й робить гілку «контур є» досяжною.
  SELECT count(*) INTO n FROM camping_spots WHERE outline IS NOT NULL;
  IF n < 1 THEN
    RAISE EXCEPTION 'CI fixture: no campsite carries a site outline';
  END IF;

  -- 🔴 І друга гілка мусить лишитись досяжною. Якби обрис колись отримали
  -- ВСІ рядки, тест «контуру немає» перевіряв би порожнечу.
  SELECT count(*) INTO n FROM camping_spots WHERE outline IS NULL;
  IF n < 1 THEN
    RAISE EXCEPTION 'CI fixture: every campsite has an outline — the "no outline" branch is unreachable';
  END IF;

  -- Точка мусить лежати НА обрисі, інакше `assertStoredOutlines()`
  -- впала б на власній фікстурі.
  SELECT count(*) INTO n
    FROM camping_spots
   WHERE outline IS NOT NULL AND ST_Distance(outline, location) <> 0;
  IF n <> 0 THEN
    RAISE EXCEPTION 'CI fixture: % outline(s) do not contain their own point', n;
  END IF;
  RAISE NOTICE 'CI fixture: both outline branches reachable, every point on its own outline';
END $$;
