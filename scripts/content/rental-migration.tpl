import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Дванадцять країн оренди переїжджають із коду в CMS — CAMP-479.
 *
 * 🔴 ЦЕЙ ФАЙЛ ЗГЕНЕРОВАНО, А НЕ НАБРАНО, як і міграція маршрутів. Текст
 * прочитано просто з `apps/web/src/data/rental/countries.ts` і
 * серіалізовано машиною: 3 818 слів передруку дають розбіжність, якої не
 * видно в рецензії.
 *
 * 🔴 ЩО САМЕ ПЕРЕЇХАЛО, А ЩО СВІДОМО ЛИШИЛОСЬ У КОДІ:
 *   • переїхало — назва, кут сторінки, вступ, підвід до заміру й три
 *     факти про країну з їхніми джерелами. Це текст, і його має правити
 *     власник;
 *   • лишилось — `data.metric` і `data.kind` (вони обирають ОБЧИСЛЕННЯ,
 *     а не показуються читачеві) та `definiteArticle` (англійська
 *     граматика назви). Редактор, що змінив би `metric`, зламав би
 *     сторінку, а не текст.
 *
 * 🔴 `thresholds.ts` НЕ ПЕРЕЇХАВ І НЕ ПЕРЕЇДЕ ЦІЄЮ КАРТКОЮ. Це не опис, а
 * регуляторні твердження: з якої маси потрібна категорія C1, де
 * перестають продавати віньєтку, коли вимагають зимові шини. Помилкову
 * цифру там побачить водій, і ніхто її не перевірить — та сама причина,
 * через яку правові сторінки лишаються в міграціях.
 *
 * 🔴 ЖОДНОЇ НОВОЇ КОЛЕКЦІЇ: прод стоїть на 25 зареєстрованих при межі 25.
 * Сторінки країн ідуть у `pages` з `type = 'rental-country'`.
 *
 * 🔴 ІДЕМПОТЕНТНО: країна, що вже є, пропускається.
 */

interface SeedSection {
  sort: number;
  /** Роль секції: `intro`, `data-intro`, `fact:N`. */
  slot: string;
  heading: string | null;
  body: string;
  items: Array<{ term: string; detail: string }>;
}

interface SeedCountry {
  code: string;
  name: string;
  angle: string;
  sections: SeedSection[];
}

const COUNTRIES: SeedCountry[] = __DATA__;

export class SeedRentalCountries1795800000000 implements MigrationInterface {
  name = 'SeedRentalCountries1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const c of COUNTRIES) {
      const seen: Array<{ count: string }> = await queryRunner.query(
        `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'rental-country'`,
        [c.code],
      );
      if (Number(seen[0]?.count ?? 0) > 0) continue;

      const page: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
         VALUES ($1, 'rental-country', 'published', now(), 0, false)
         RETURNING id`,
        [c.code],
      );
      const pageId = page[0].id;

      await queryRunner.query(
        `INSERT INTO page_translations
           (page_id, language_code, title, meta_title, meta_description)
         VALUES ($1, 'en', $2, $2, $3)`,
        [pageId, c.name, c.angle],
      );

      for (const s of c.sections) {
        const row: Array<{ id: string }> = await queryRunner.query(
          `INSERT INTO page_sections (page_id, sort, type, slot, visible)
           VALUES ($1, $2, 'prose', $3, true) RETURNING id`,
          [pageId, s.sort, s.slot],
        );
        await queryRunner.query(
          `INSERT INTO page_section_translations
             (section_id, language_code, heading, body, items)
           VALUES ($1, 'en', $2, $3, $4::jsonb)`,
          [row[0].id, s.heading, s.body, JSON.stringify(s.items)],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = COUNTRIES.map((c) => c.code);
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE slug = ANY($1) AND type = 'rental-country')`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM pages WHERE slug = ANY($1) AND type = 'rental-country'`,
      [codes],
    );
  }
}
