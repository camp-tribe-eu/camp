import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Слот під власне зображення банера країни — CAMP-469, частина 1.
 *
 * 🔴 ЧОМУ ЗОБРАЖЕННЯ СТАВИТЬ ЛИШЕ ВЛАСНИК. На сайті надруковано правило
 * «No stock photography and no AI-generated images of places nobody has
 * visited». Зображення, прив'язане до країни, зображує місце, тож його
 * не можна ні згенерувати, ні взяти зі стоку. Тому джерело — CMS, а в
 * цій міграції зображень НЕМАЄ: вона створює порожні слоти, не картинки.
 *
 * 🔴 ЖОДНОЇ НОВОЇ КОЛЕКЦІЇ. Прод стоїть на 25 зареєстрованих із 25, і
 * зареєстрована колекція коштує слот, навіть схована. Заміряно: країни
 * кемпінгів НЕ мають власної таблиці — `/spots/countries` це
 * `GROUP BY country` по `camping_spots`, а `camper_types`, `guides` тощо
 * до країн не прив'язані. Тому країна — рядок у `pages` з
 * `type = 'camping-country'` і слагом = код країни (той самий прецедент,
 * що `rental-country` у CAMP-479), а нове лише два ПОЛЯ наявних колекцій:
 *   • `pages.banner_image_url` — адреса зображення;
 *   • `page_translations.banner_image_alt` — його опис для незрячих (alt
 *     — це текст, тож живе в перекладі, а не в сторінці).
 *
 * 🔴 ЧОМУ ТЕКСТОВЕ ПОЛЕ, А НЕ ПІДБІРНИК ФАЙЛА. Так само, як
 * `page_sections.image_url`: підбірник вимагає звʼязку з `directus_files`,
 * а на чистій базі (CI, нова машина) цієї таблиці ще немає — зовнішній
 * ключ на неї валить міграцію. Власник вставляє id файла або адресу
 * `…/assets/<id>` з файлової бібліотеки Directus (або шлях від кореня).
 * Файл віддає наш origin через `/media/country-banner/<код>`: публічного
 * читання `directus_files` немає, CSP не чіпано (`apps/web/src/lib/cms-file.ts`).
 *
 * 🔴 ЯКЩО ПОЛЕ ПОРОЖНЄ — ЧИТАЧ БАЧИТЬ ТЕ, ЩО Й БУЛО (`eu-dawn.svg`).
 * Усі 27 рядків засіяно порожніми.
 *
 * 🔴 27 РЯДКІВ — ЦЕ ЄС-27 (`osm/eu-member-states.json`), включно з `cy`:
 * Кіпр не публікується (CAMP-490), а рядок у CMS лише слот і нікому не
 * видний. Регіонів тут немає навмисно (627 — окреме рішення).
 *
 * 🔴 ІДЕМПОТЕНТНО: країна, що вже є, пропускається.
 */
const COUNTRIES: ReadonlyArray<readonly [string, string]> = [
  ['at', 'Austria'],
  ['be', 'Belgium'],
  ['bg', 'Bulgaria'],
  ['hr', 'Croatia'],
  ['cy', 'Cyprus'],
  ['cz', 'Czechia'],
  ['dk', 'Denmark'],
  ['ee', 'Estonia'],
  ['fi', 'Finland'],
  ['fr', 'France'],
  ['de', 'Germany'],
  ['gr', 'Greece'],
  ['hu', 'Hungary'],
  ['ie', 'Ireland'],
  ['it', 'Italy'],
  ['lv', 'Latvia'],
  ['lt', 'Lithuania'],
  ['lu', 'Luxembourg'],
  ['mt', 'Malta'],
  ['nl', 'Netherlands'],
  ['pl', 'Poland'],
  ['pt', 'Portugal'],
  ['ro', 'Romania'],
  ['sk', 'Slovakia'],
  ['si', 'Slovenia'],
  ['es', 'Spain'],
  ['se', 'Sweden'],
];

export class CampingCountryBanner1796300000000 implements MigrationInterface {
  name = 'CampingCountryBanner1796300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE pages ADD COLUMN IF NOT EXISTS banner_image_url text`,
    );
    await queryRunner.query(
      `ALTER TABLE page_translations ADD COLUMN IF NOT EXISTS banner_image_alt text`,
    );

    for (const [code, name] of COUNTRIES) {
      const seen: Array<{ count: string }> = await queryRunner.query(
        `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'camping-country'`,
        [code],
      );
      if (Number(seen[0]?.count ?? 0) > 0) continue;

      const page: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
         VALUES ($1, 'camping-country', 'published', now(), 0, false)
         RETURNING id`,
        [code],
      );
      await queryRunner.query(
        `INSERT INTO page_translations (page_id, language_code, title)
         VALUES ($1, 'en', $2)`,
        [page[0].id, name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Перекладів не чіпаємо руками: `page_translations` видаляється
    // каскадом разом зі сторінкою.
    await queryRunner.query(`DELETE FROM pages WHERE type = 'camping-country'`);
    await queryRunner.query(
      `ALTER TABLE page_translations DROP COLUMN IF EXISTS banner_image_alt`,
    );
    await queryRunner.query(
      `ALTER TABLE pages DROP COLUMN IF EXISTS banner_image_url`,
    );
  }
}
