import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-525: `/camping/winter` у меню — пункт у колонці «Campsites» підвалу.
 *
 * Сторож `navigation.spec.ts` (CAMP-365/448) почервонів на PR #589: сторінка
 * є в маршрутах, а читач не має до неї жодного посилання з шапки чи підвалу.
 * Підвал, а не мега-панель шапки: панель «Campsites» у шапці показує країни,
 * а колонка підвалу — розділи каталогу (Map, Search, Routes, Guides), і зима
 * — саме розділ.
 *
 * Ідемпотентно: якщо власник уже додав пункт у CMS, другого не буде.
 */
export class NavWinterPage1797910000000 implements MigrationInterface {
  name = 'NavWinterPage1797910000000';

  private readonly href = '/camping/winter';

  public async up(q: QueryRunner): Promise<void> {
    const parent = (await q.query(
      `SELECT id FROM navigation
        WHERE location = 'footer' AND href = '/camping' AND parent_id IS NULL
        LIMIT 1`,
    )) as Array<{ id: string }>;
    if (parent.length === 0) {
      throw new Error(
        'CAMP-525: у підвалі немає колонки /camping, під яку мав стати ' +
          '/camping/winter. Перевір HeaderFooterMenus1797480000000.',
      );
    }
    const seen = (await q.query(
      `SELECT id FROM navigation
        WHERE location = 'footer' AND href = $1 AND parent_id = $2`,
      [this.href, parent[0].id],
    )) as Array<{ id: string }>;
    if (seen.length > 0) return;

    const next = (await q.query(
      `SELECT coalesce(max(sort), -1) + 1 AS sort FROM navigation
        WHERE location = 'footer' AND parent_id = $1`,
      [parent[0].id],
    )) as Array<{ sort: number }>;
    const row = (await q.query(
      `INSERT INTO navigation (location, sort, href, parent_id, visible)
       VALUES ('footer', $1, $2, $3, true) RETURNING id`,
      [next[0].sort, this.href, parent[0].id],
    )) as Array<{ id: string }>;
    await q.query(
      `INSERT INTO navigation_translations (navigation_id, language_code, label)
       VALUES ($1, 'en', 'Winter camping')`,
      [row[0].id],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM navigation_translations WHERE navigation_id IN (
         SELECT c.id FROM navigation c
           JOIN navigation p ON p.id = c.parent_id
          WHERE c.location = 'footer' AND c.href = $1
            AND p.location = 'footer' AND p.href = '/camping' AND p.parent_id IS NULL)`,
      [this.href],
    );
    await q.query(
      `DELETE FROM navigation c USING navigation p
        WHERE p.id = c.parent_id
          AND c.location = 'footer' AND c.href = $1
          AND p.location = 'footer' AND p.href = '/camping' AND p.parent_id IS NULL`,
      [this.href],
    );
  }
}
