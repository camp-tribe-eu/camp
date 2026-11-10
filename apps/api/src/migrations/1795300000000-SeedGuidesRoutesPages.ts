import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * /guides і /routes переїжджають із коду в CMS — CAMP-459, CAMP-460.
 *
 * 🔴 ПРИЧИНА — ВКАЗІВКА ВЛАСНИКА 10.11.2026: «все має бути динамічним
 * щоб я міг міняти контент на бойовий». Заміряно того ж дня: /tools,
 * /about і /contact читають CMS (`pageContent`), а /guides і /routes —
 * НЕ читають її зовсім (жодного виклику), і весь їхній текст лежить у
 * коді. Тобто змінити вступ на цих двох сторінках власник не міг ніяк,
 * окрім як попросити мене.
 *
 * 🔴 ТЕКСТ ПЕРЕНЕСЕНО ДОСЛІВНО, А НЕ ПЕРЕПИСАНО. Переїзд, який заразом
 * «трохи покращує формулювання», неможливо перевірити: diff показав би
 * зміну і там, де її не планували. Слова ті самі, що стояли в коді;
 * доказ — e2e, який вимагає їх від живої сторінки.
 *
 * 🔴 ЧИСЛО «TWELVE» ЗАЛИШЕНО В ТЕКСТІ, бо воно стояло там і до переїзду.
 * Воно не рахується кодом, і це вже борг — але борг, який існував до
 * цієї міграції. Виправляти його тут означало б змінити зміст під
 * виглядом переїзду.
 *
 * 🔴 `type` І `status` ЗАДАНІ ЯВНО — на /about цього колись не зробили,
 * і сторінка поїхала читачеві чернеткою (рецензія PR #302).
 */
export class SeedGuidesRoutesPages1795300000000 implements MigrationInterface {
  name = 'SeedGuidesRoutesPages1795300000000';

  private readonly pages = [
    {
      slug: 'guides',
      title: 'Guides',
      metaTitle: 'Camping guides by region',
      metaDescription:
        'Each guide answers one question about one region, using counts from our own records — including how many campsites have nothing recorded.',
      prose:
        'Each of these answers one question about one region, using counts from our own records. They say how many campsites have something recorded — and how many have nothing, which is usually the larger number and the reason to trust the rest.',
    },
    {
      slug: 'routes',
      title: 'Camping routes',
      metaTitle: 'Camping routes across Europe',
      metaDescription:
        'Ordered sets of stops through the European Union, each with the campsites our database actually holds near every stage.',
      prose:
        'Twelve routes through the European Union, each one an ordered set of stops with the campsites our database actually holds near every stage. They are written to be argued with: each says what it is for, when it works, what the driving is like, and who it does not suit.',
    },
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const page of this.pages) {
      const existing: Array<{ count: string }> = await queryRunner.query(
        `SELECT count(*)::text AS count FROM pages WHERE slug = $1`,
        [page.slug],
      );
      if (Number(existing[0]?.count ?? 0) > 0) continue;

      const row: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
         VALUES ($1, 'page', 'published', now(), 1, false)
         RETURNING id`,
        [page.slug],
      );
      const pageId = row[0].id;

      await queryRunner.query(
        `INSERT INTO page_translations (page_id, language_code, title, meta_title, meta_description)
         VALUES ($1, 'en', $2, $3, $4)`,
        [pageId, page.title, page.metaTitle, page.metaDescription],
      );

      const prose: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO page_sections (page_id, sort, type, visible)
         VALUES ($1, 0, 'prose', true) RETURNING id`,
        [pageId],
      );
      await queryRunner.query(
        `INSERT INTO page_section_translations (section_id, language_code, body)
         VALUES ($1, 'en', $2)`,
        [prose[0].id, page.prose],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const page of this.pages) {
      await queryRunner.query(
        `DELETE FROM page_translations
          WHERE page_id IN (SELECT id FROM pages WHERE slug = $1)`,
        [page.slug],
      );
      await queryRunner.query(`DELETE FROM pages WHERE slug = $1`, [page.slug]);
    }
  }
}
