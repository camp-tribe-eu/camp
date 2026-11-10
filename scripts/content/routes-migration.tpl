import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Дванадцять маршрутів переїжджають із коду в CMS — CAMP-479, крок 2 із 2.
 *
 * 🔴 ЦЕЙ ФАЙЛ ЗГЕНЕРОВАНО, А НЕ НАБРАНО. Текст прочитано просто з
 * `apps/web/src/data/routes/*.ts` і серіалізовано машиною. Інакше
 * «перенесено дослівно» було б недоказовим: 7 813 слів передруку дають
 * розбіжність, якої не видно в рецензії, бо diff показує лише те, що
 * хтось додав, а не те, що він тихо переписав.
 *
 * 🔴 РОЗДІЛЕННЯ ЗА ПРИРОДОЮ ДАНИХ, А НЕ ЗА ЗРУЧНІСТЮ:
 *   • факти (слаг, країни, дні, місяці, координати, ночі) → `routes`
 *     і `route_points` — колонки з типами, які редактор не зламає
 *     одруківкою;
 *   • проза (назва, підсумок, вступ, сезон, дороги, «чому цей етап»)
 *     → `pages` + `page_translations` + `page_sections`, тобто туди ж,
 *     де вже живе решта тексту сайту й де працює переклад.
 *
 * 🔴 ЖОДНОЇ НОВОЇ КОЛЕКЦІЇ. Прод стоїть на 25 зареєстрованих при межі
 * 25 (заміряно 10.11.2026). `routes` і `route_points` уже існували й
 * були порожні; `pages` теж існує. Власні таблиці перекладів коштували
 * б двох слотів, яких немає.
 *
 * 🔴 ІДЕМПОТЕНТНО: маршрут, який уже є, пропускається. Міграція, що
 * подвоює контент при повторному прогоні, робить відкат неможливим.
 */

interface SeedSection {
  sort: number;
  type: string;
  heading: string | null;
  body: string;
  items?: Array<{ term: string; detail: string }> | null;
}

interface SeedRoute {
  slug: string;
  name: string;
  summary: string;
  region: string;
  countries: string[];
  days: number;
  months: number[];
  suits: string[];
  curatedAt: string;
  attribution: string;
  stages: Array<{ name: string; lat: number; lon: number; nights: number }>;
  sections: SeedSection[];
}

const ROUTES: SeedRoute[] = __DATA__;

export class SeedRoutesContent1795600000000 implements MigrationInterface {
  name = 'SeedRoutesContent1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const r of ROUTES) {
      const seen: Array<{ count: string }> = await queryRunner.query(
        `SELECT count(*)::text AS count FROM routes WHERE slug = $1`,
        [r.slug],
      );
      if (Number(seen[0]?.count ?? 0) > 0) continue;

      const route: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO routes
           (slug, duration_days, countries, months, suits, curated_at, region)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7)
         RETURNING id`,
        [r.slug, r.days, r.countries, r.months, r.suits, r.curatedAt, r.region],
      );
      const routeId = route[0].id;

      for (const [i, st] of r.stages.entries()) {
        await queryRunner.query(
          `INSERT INTO route_points (route_id, sequence, name, location, nights)
           VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6)`,
          [routeId, i, st.name, st.lon, st.lat, st.nights],
        );
      }

      const page: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
         VALUES ($1, 'route', 'published', now(), 0, false)
         RETURNING id`,
        [r.slug],
      );
      const pageId = page[0].id;

      await queryRunner.query(
        `INSERT INTO page_translations
           (page_id, language_code, title, meta_title, meta_description)
         VALUES ($1, 'en', $2, $2, $3)`,
        [pageId, r.name, r.summary],
      );

      const sections: SeedSection[] = [
        ...r.sections,
        {
          sort: r.sections.length,
          type: 'prose',
          heading: 'Where this data comes from',
          body: r.attribution,
        },
      ];

      for (const s of sections) {
        const row: Array<{ id: string }> = await queryRunner.query(
          `INSERT INTO page_sections (page_id, sort, type, visible)
           VALUES ($1, $2, $3, true) RETURNING id`,
          [pageId, s.sort, s.type],
        );
        await queryRunner.query(
          `INSERT INTO page_section_translations
             (section_id, language_code, heading, body, items)
           VALUES ($1, 'en', $2, $3, $4::jsonb)`,
          [
            row[0].id,
            s.heading,
            s.body,
            // 🔴 ПОРОЖНІЙ МАСИВ, А НЕ `null`: колонка `items` оголошена
            // NOT NULL (заміряно падінням міграції). «Переліку немає» і
            // «перелік порожній» тут одне й те саме, бо рендерер читає
            // довжину, а не наявність.
            JSON.stringify(s.items ?? []),
          ],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const slugs = ROUTES.map((r) => r.slug);
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE slug = ANY($1) AND type = 'route')`,
      [slugs],
    );
    await queryRunner.query(
      `DELETE FROM pages WHERE slug = ANY($1) AND type = 'route'`,
      [slugs],
    );
    await queryRunner.query(
      `DELETE FROM route_points WHERE route_id IN (SELECT id FROM routes WHERE slug = ANY($1))`,
      [slugs],
    );
    await queryRunner.query(`DELETE FROM routes WHERE slug = ANY($1)`, [slugs]);
  }
}
