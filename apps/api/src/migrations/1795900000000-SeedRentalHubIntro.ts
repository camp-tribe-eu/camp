import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Вступ хаба оренди переїжджає в CMS — CAMP-478.
 *
 * 🔴 ПЕРЕНЕСЕНО ОДИН АБЗАЦ, А НЕ ВСЮ СТОРІНКУ, І ЦЕ НЕ ПІВЗАХОДИ.
 *
 * Другий абзац хаба містить ЧИСЛА, які рахує код: скільки в нас записів
 * кемпінгів і коли їх заміряли. Речення, що рахує згенероване, мусить
 * жити з генератором — інакше редактор залишить старе число поруч зі
 * свіжими даними, і сторінка почне брехати тихо, лишаючись граматично
 * бездоганною. Та сама пастка, що була з «twelve routes» (CAMP-479).
 *
 * Перший абзац чисел не має: це опис того, про що сторінка. Його
 * власник має право переписати сам.
 *
 * 🔴 ТЕКСТ ПЕРЕНЕСЕНО ДОСЛІВНО. Переїзд, який заразом «покращує
 * формулювання», неможливо перевірити.
 */
export class SeedRentalHubIntro1795900000000 implements MigrationInterface {
  name = 'SeedRentalHubIntro1795900000000';

  private readonly intro =
    'This page is about the things that are decided before you drive away: ' +
    'which licence covers the vehicle, what it is allowed to weigh once ' +
    'loaded, what it costs to take on a motorway, and what the contract has ' +
    'quietly made your problem. Those answers differ across the twenty-seven ' +
    'member states and they are not collected anywhere in one piece, which is ' +
    'the only reason this page exists.';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = 'camper-rental'`,
    );
    if (Number(existing[0]?.count ?? 0) > 0) return;

    const row: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ('camper-rental', 'page', 'published', now(), 1, false)
       RETURNING id`,
    );
    const pageId = row[0].id;

    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_title)
       VALUES ($1, 'en', 'Renting a camper in the EU', 'Renting a camper in the EU')`,
      [pageId],
    );

    const section: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO page_sections (page_id, sort, type, slot, visible)
       VALUES ($1, 0, 'prose', 'intro', true) RETURNING id`,
      [pageId],
    );
    await queryRunner.query(
      `INSERT INTO page_section_translations (section_id, language_code, body, items)
       VALUES ($1, 'en', $2, '[]'::jsonb)`,
      [section[0].id, this.intro],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE slug = 'camper-rental')`,
    );
    await queryRunner.query(`DELETE FROM pages WHERE slug = 'camper-rental'`);
  }
}
