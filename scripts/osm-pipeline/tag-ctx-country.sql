-- CAMP-296: проставити кожному місту, супермаркету й станції країну, де він стоїть.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--        -f scripts/osm-pipeline/tag-ctx-country.sql
--
-- Читає osm_country_area (її будує build-country-area.sql), пише колонку
-- `country` в osm_ctx_place і osm_ctx_poi. Воду НЕ чіпає: див. CONTEXT_SQL у
-- apps/api/src/osm/context-sql.ts.
--
-- 🔴 ПОЧЕМУ КОЛОНКА, А НЕ УМОВА В ЗАПИТІ: планувальник не вміє поєднати
-- просторовий зв'язок із KNN-сортуванням — заміряно, супермаркет з умовою
-- через EXISTS 56 с на 30 кемпінгів проти 6 мс без неї. Тут країна
-- вираховується раз, на 500 тисяч рядків, секундами.
--
-- 🔴 КОЛОНКА ЖИВЕ ДО НАСТУПНОГО `load-context.sh`. Він робить
-- `ogr2ogr -overwrite` і пересоздає обидві таблиці без неї. Після кожного
-- перезавантаження шарів запустіть це знову:
--   ./scripts/osm-pipeline/load-country-boundaries.sh --tag-only
-- compute-context без колонки не запуститься (assertCountryTagsReady).
--
-- 🔴 ЗНАЧЕННЯ: ISO-код країни малими (`pl`, `gr`) — той самий, що в
-- eu-member-states.json. Порожній рядок — «перевірено, в жодному полігоні».
-- NULL — «ще не проставлено»; після цього файлу NULL не лишається. Різниця
-- потрібна перевірці: порожнє не мусить виглядати як недороблене.
--
-- 🔴 ТОЧКА, А НЕ ГЕОМЕТРІЯ: супермаркети в osm_ctx_poi — і вузли, і контури
-- будівель; ST_PointOnSurface гарантовано лежить НА фігурі, на відміну від
-- центроїда (route-poi-sql.ts пояснює, чим це кінчається).
--
-- Ідемпотентний: другий запуск дає ті самі значення.
-- Без psql-метакоманд і без BEGIN/COMMIT — з тієї ж причини, що й
-- build-country-area.sql: цей текст виконує і psql, і тест через node-postgres.

ALTER TABLE osm_ctx_place ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE osm_ctx_poi   ADD COLUMN IF NOT EXISTS country text;

UPDATE osm_ctx_place x
   SET country = COALESCE(
         (SELECT min(c.iso) FROM osm_country_area c
           WHERE c.geom && ST_PointOnSurface(x.geom)
             AND ST_Covers(c.geom, ST_PointOnSurface(x.geom))),
         '');

UPDATE osm_ctx_poi x
   SET country = COALESCE(
         (SELECT min(c.iso) FROM osm_country_area c
           WHERE c.geom && ST_PointOnSurface(x.geom)
             AND ST_Covers(c.geom, ST_PointOnSurface(x.geom))),
         '');
