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
 *   w… (way)      856    1,4%   контур Є
 *   n… (node)  19 657   31,1%   контуру НЕМА — в OSM це крапка
 *   без ref     8 752   13,9%   прийшло не з OSM
 *
 * Тобто для 45% обрису не існує в ПЕРШОДЖЕРЕЛІ, і `NOT NULL` тут
 * означав би вимагати від даних того, чого в них немає.
 *
 * 🔴 ЧОМУ `MultiPolygon`, А НЕ `Polygon`. У staging геометрія лежить саме
 * як `MULTIPOLYGON` (заміряно: 10 437 рядків останньої партії). Кемпінг
 * буває розрізаний дорогою чи річкою на кілька шматків, і звести це до
 * одного полігона означало б мовчки викинути частину ділянки.
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
    // 🔴 Обрис мусить бути ТАМ, де місце. Якщо контур лежить за
    // кілометри від точки, це не «неточність» — це переплутаний рядок,
    // і побачити його треба при записі, а не на сторінці читача.
    // Межа щедра навмисно: 0,05° це ~5,5 км по широті, тобто більше за
    // будь-який кемпінг, але менше за помилку зʼєднання.
    await queryRunner.query(`
      ALTER TABLE camping_spots
        ADD CONSTRAINT camping_spots_outline_near_location
        CHECK (
          outline IS NULL
          OR ST_DWithin(ST_Centroid(outline), location, 0.05)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camping_spots
        DROP CONSTRAINT IF EXISTS camping_spots_outline_near_location
    `);
    await queryRunner.query(`
      ALTER TABLE camping_spots DROP COLUMN IF EXISTS outline
    `);
  }
}
