import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Налаштування сайту перестають бути порожньою колекцією — CAMP-481.
 *
 * 🔴 ПРИЧИНА. Заміряно 10.11.2026: `site_settings` видима в Directus,
 * має поля `tagline`, `footer_note`, `contact_email`, `social_links` —
 * і в ній НУЛЬ рядків, а пошук по всьому `apps/web/src` за цими іменами
 * дає нуль збігів. Тобто адмін відкривав порожню форму, яка ні на що не
 * впливає. Це гірше за хардкод: хардкод чесний (видно, що не можна), а
 * тут людина натисне «зберегти», побачить успіх і вирішить, що зламався
 * сайт.
 *
 * 🔴 ТЕКСТ ПЕРЕНЕСЕНО ДОСЛІВНО З КОДУ, А НЕ НАПИСАНО НАНОВО.
 * `footer_note` — речення, що стояло в `site-chrome.tsx`; `tagline` —
 * `BRAND_DESCRIPTION` із `lib/brand.ts`. Переїзд, який заразом
 * «покращує формулювання», неможливо перевірити: diff показав би зміну
 * і там, де її не планували.
 *
 * 🔴 `contact_email` І `social_links` ТУТ НЕ ЗАПОВНЮЮТЬСЯ, І ЦЕ НЕ
 * НЕДОГЛЯД. Пошта компанії — правовий реквізит: вона стоїть у `COMPANY`
 * поруч із номером підприємства й адресою, і її версію стереже перевірка
 * правових сторінок. Дати редактору другу копію означало б два джерела
 * правди для того, що зобовʼязує нас за бельгійським правом, і
 * розійшлась би саме та копія, якої ніхто не читає. Соцмереж у підвалі
 * сьогодні немає взагалі — заповнити поле означало б пообіцяти вивід,
 * якого не існує.
 *
 * Що з цими двома полями робити далі — прибрати з видимих чи під'єднати
 * — вирішується окремо; поки їх не читає ніхто, вони лишаються порожні,
 * і сторож із картки має це називати.
 */
export class SeedSiteSettings1795400000000 implements MigrationInterface {
  name = 'SeedSiteSettings1795400000000';

  /** Речення з підвалу `site-chrome.tsx`, слово в слово. */
  private readonly footerNote =
    'Campsites across the EU-27, with what is around each one — ' +
    'measured from published data, with the gaps left as gaps.';

  /** `BRAND_DESCRIPTION` з `apps/web/src/lib/brand.ts`, слово в слово. */
  private readonly tagline =
    'Find campsites, plan routes and book camper rentals across Europe in one place.';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM site_settings`,
    );
    if (Number(existing[0]?.count ?? 0) > 0) return;

    const row: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO site_settings (singleton) VALUES (true) RETURNING id`,
    );

    await queryRunner.query(
      `INSERT INTO site_settings_translations (settings_id, language_code, tagline, footer_note)
       VALUES ($1, 'en', $2, $3)`,
      [row[0].id, this.tagline, this.footerNote],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM site_settings_translations
        WHERE settings_id IN (SELECT id FROM site_settings WHERE singleton)`,
    );
    await queryRunner.query(`DELETE FROM site_settings WHERE singleton`);
  }
}
