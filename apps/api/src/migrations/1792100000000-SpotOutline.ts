import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-352 — контур ділянки кемпінгу.
 *
 * `camping_spots.location` це `geometry(Point,4326)`, і полігональної
 * колонки не було взагалі. Водночас макет `Design/01-campsite.html`
 * обіцяє читачеві саме обрис:
 *
 *   What you see above is the real site outline from OpenStreetMap —
 *   the shape of the ground, not a photo of somewhere else.
 *
 * Крапка цього не каже: вона не показує ні розміру ділянки, ні форми,
 * ні того, де та межує з водою чи дорогою.
 *
 * 🔴 NULLABLE, І ЦЕ НОРМАЛЬНИЙ СТАН, А НЕ ЗБІЙ. Заміряно на проді
 * 20.10.2026 по всіх 63 159 рядках, за префіксом `osm_ref`:
 *
 *   a… (area)  33 894   53,7%   контур Є
 *   w… (way)      856    1,4%   контуру НЕМА (див. нижче)
 *   n… (node)  19 657   31,1%   контуру НЕМА — в OSM це крапка
 *   без ref     8 752   13,9%   прийшло не з OSM
 *
 * Тобто контур можливий для 33 894 — 53,7%, а для 29 265 (46,4%) його
 * не існує в ПЕРШОДЖЕРЕЛІ. `NOT NULL` тут вимагав би від даних того,
 * чого в них немає.
 *
 * 🔴 `w…` ЦЕ НЕ КОНТУР, І КАРТКА ТУТ ПОМИЛЯЛАСЬ. `normalise-export.mjs`
 * (рядок 11) пояснює чому: `osmium export` віддає ЗАКРИТИЙ way ДВІЧІ —
 * як LineString під `w<id>` і як Polygon під `a<id>`, бо libosmium
 * нумерує площі `way × 2`. Ранжування лишає полігон. Отже `w…`, який
 * вижив, — це way БЕЗ полігона, тобто незамкнена лінія.
 *
 * Заміряно в staging: 10 437 MULTIPOLYGON і 2 531 POINT, рядків із
 * `w…` — НУЛЬ. Тому завантажувач не сміє писати їх у цю колонку:
 * `ST_Multi(LineString)` дає MULTILINESTRING і впаде на typmod.
 *
 * 🔴 ЧОМУ `MultiPolygon`, А НЕ `Polygon`. У staging геометрія лежить саме
 * як `MULTIPOLYGON` (заміряно: 10 437 рядків останньої партії). Кемпінг
 * буває розрізаний дорогою чи річкою на кілька шматків, і звести це до
 * одного полігона означало б мовчки викинути частину ділянки.
 *
 * 🔴 ОБМЕЖЕННЯ — ЦЕ НАЛЕЖНІСТЬ, А НЕ ВІДСТАНЬ. Перша редакція питала,
 * чи центроїд контуру лежить у 0,05° від точки. Рецензія показала, що
 * такий сторож сліпий саме на тій помилці, заради якої написаний: на
 * проді 54 357 із 63 159 (86,1%) кемпінгів мають СУСІДА в межах 0,05°,
 * а власний матчер проєкту взагалі не парує далі ніж 400 м. Тобто він
 * ловив би лише плутанину за 5,5 км, а реальна виглядає як «контур
 * сусіднього кемпінгу».
 *
 * Правильне питання інше. `location` будується як `ST_PointOnSurface`
 * ТІЄЇ Ж фігури (`osm/import-spots.ts:667`), а `outline` — її ж
 * `ST_Multi`. Отже точка мусить лежати НА контурі, і це не оцінка, а
 * тотожність.
 *
 * Заміряно на 10 437 полігонах staging:
 *   ST_Distance(geom, ST_PointOnSurface(geom)) = 0.0000000000  ← завжди
 *   ST_Distance(geom, ST_Centroid(geom))       = 0.0009869204  ← максимум
 *
 * Центроїд падає ПОЗА фігуру — саме тому сусідній код теж бере
 * `ST_PointOnSurface` (`tag-ctx-country.sql:27`, `route-poi-sql.ts:44`).
 *
 * Допуск `0.0001` — це лише запас на округлення, не на відстань. По
 * широті це ~11 м; по довготі менше й залежить від широти: на 70° (а
 * максимум у нас 69,91°, Фінляндія) ~3,8 м. Числа названі в обох осях
 * навмисно: `ST_DWithin` на geometry рахує в ГРАДУСАХ, тож «метри» тут
 * завжди питання «на якій широті».
 *
 * 🔴 ІНДЕКСУ ТУТ НЕМАЄ НАВМИСНО. Обрис читається ЗА ПЕРВИННИМ КЛЮЧЕМ —
 * сторінка кемпінгу вже знає свій рядок. Просторових запитів «знайди
 * кемпінги, що перетинають область» по цій колонці немає жодного:
 * пошук по мапі йде через `location`, у якої свій індекс. GiST на
 * 34 750 мультиполігонах коштував би місця й часу запису заради
 * запитів, яких ніхто не пише. Зʼявляться — додамо окремою міграцією,
 * і тоді буде видно, заради чого.
 */
export class SpotOutline1792100000000 implements MigrationInterface {
  name = 'SpotOutline1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD COLUMN IF NOT EXISTS outline geometry(MultiPolygon, 4326)
    `);
    // Точка мусить лежати НА контурі — чому саме так, написано вище.
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD CONSTRAINT camping_spots_location_on_outline
        CHECK (
          outline IS NULL
          OR ST_DWithin(outline, location, 0.0001)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS camping_spots_location_on_outline
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots DROP COLUMN IF EXISTS outline
    `);
  }
}
