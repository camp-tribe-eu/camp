import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * /camping — сторінка в CMS (CAMP-478).
 *
 * Хаб країн був єдиною великою сторінкою, де заголовок, слово на банері й
 * опис для пошуковика стояли літералами в коді. Тепер — запис `pages`
 * (slug `camping`), як /guides і /routes, і власник править їх сам.
 *
 * Опис ПІД заголовком банера лишається в коді (`campingLead`): він рахує
 * кемпінги й країни, а число мусить жити з генератором.
 *
 * Мета-опис написано наново (правило власника 19.11.2026: контент —
 * продакшн). 🔴 Без «27»: плиток на сторінці стільки, скільки країн
 * показуємо (Кіпру немає), і число в тексті розійшлося б із плитками —
 * саме цю розбіжність закрила CAMP-490.
 *
 * `type` і `status` задані явно (рецензія PR #302).
 */
const PAGE = {
  slug: 'camping',
  title: 'Campsites in Europe',
  metaTitle: 'Campsites in Europe by country and region',
  metaDescription:
    'Campsites, motorhome parks and camper stops across the European Union, country by country and region by region, with what lies around each one.',
  ticker: 'EUROPE',
} as const;

export class SeedCampingIndexPage1798020000000 implements MigrationInterface {
  name = 'SeedCampingIndexPage1798020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1`,
      [PAGE.slug],
    );
    if (Number(existing[0]?.count ?? 0) > 0) return;

    const row: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), 1, false)
       RETURNING id`,
      [PAGE.slug],
    );
    await queryRunner.query(
      `INSERT INTO page_translations
         (page_id, language_code, title, meta_title, meta_description, banner_ticker)
       VALUES ($1, 'en', $2, $3, $4, $5)`,
      [
        row[0].id,
        PAGE.title,
        PAGE.metaTitle,
        PAGE.metaDescription,
        PAGE.ticker,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE slug = $1 AND type = 'page')`,
      [PAGE.slug],
    );
    await queryRunner.query(
      `DELETE FROM pages WHERE slug = $1 AND type = 'page'`,
      [PAGE.slug],
    );
  }
}
