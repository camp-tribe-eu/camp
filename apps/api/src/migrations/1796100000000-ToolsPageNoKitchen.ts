import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-463: сторінка /tools перестає розповідати читачеві про нашу
 * кухню. Два місця, обидва в CMS (`page_section_translations`), тому
 * міграція, а не правка в коді.
 *
 * 🔴 ЩО ТАМ СТОЯЛО (заміряно `curl`-ом до продакшну 11.11.2026):
 *
 *   вступ:    «…its table of all 27 countries is served as plain HTML,
 *              so it reads without JavaScript.»
 *   завершення: «A camper comparison tool was planned alongside these. It
 *              needs rental models and prices from partners we have not
 *              integrated yet, and a comparison assembled from numbers we
 *              made up would undo the point of the other two. It arrives
 *              when the data does.»
 *
 * Перше — розповідь про спосіб, яким зроблено сторінку: читач не питав,
 * чи читається вона без JavaScript. Друге — план, стан наших перемовин
 * із партнерами й обіцянка з датою, якої ми не знаємо. Другий абзац
 * ПРИБРАНО, а не перефразовано: нема що казати читачеві про інструмент,
 * якого немає.
 *
 * 🔴 ІДЕМПОТЕНТНО Й ТОЧКОВО, І ЦЕ ПРИНЦИПОВО ІНАКШЕ, НІЖ У
 * `DriveSlotNoRoadmap`. Та міграція шукала рядок за `slot` і
 * перезаписувала його безумовно. Ця шукає за ДОСЛІВНИМ старим текстом
 * (він береться з міграції, що його засіяла, а не з памʼяті): якщо
 * власник уже правив цей абзац у CMS, тексту, що збігається, нема — і
 * його правка не перезаписується мовчки. Той самий принцип, що в
 * `RoutesIntroDropsCount` (CAMP-479).
 *
 * 🔴 НЕ ВИДАЛЯЄТЬСЯ СТОРІНКА Й НЕ ЧІПАЮТЬСЯ КАРТКИ ІНСТРУМЕНТІВ: лише
 * один фрагмент у вступі й один завершальний блок.
 */
export class ToolsPageNoKitchen1796100000000 implements MigrationInterface {
  name = 'ToolsPageNoKitchen1796100000000';

  /** Дослівно те, що засіяла `SeedToolsPage`. */
  static readonly OLD_INTRO_TAIL =
    ', and its table of all 27 countries is served as plain HTML, so it reads without JavaScript.';

  static readonly NEW_INTRO_TAIL = ', with a table of all 27 countries.';

  static readonly OLD_CLOSING =
    'A camper comparison tool was planned alongside these. It needs rental models and prices from partners we have not integrated yet, and a comparison assembled from numbers we made up would undo the point of the other two. It arrives when the data does.';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE page_section_translations st
          SET body = replace(st.body, $1::text, $2::text)
         FROM page_sections s, pages p
        WHERE st.section_id = s.id
          AND s.page_id = p.id
          AND p.slug = 'tools'
          AND st.body LIKE '%' || $1::text || '%'`,
      [
        ToolsPageNoKitchen1796100000000.OLD_INTRO_TAIL,
        ToolsPageNoKitchen1796100000000.NEW_INTRO_TAIL,
      ],
    );
    await queryRunner.query(
      `DELETE FROM page_sections
        WHERE id IN (
          SELECT s.id
            FROM page_sections s
            JOIN pages p ON p.id = s.page_id
            JOIN page_section_translations st ON st.section_id = s.id
           WHERE p.slug = 'tools'
             AND st.body = $1::text
        )`,
      [ToolsPageNoKitchen1796100000000.OLD_CLOSING],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE page_section_translations st
          SET body = replace(st.body, $1::text, $2::text)
         FROM page_sections s, pages p
        WHERE st.section_id = s.id
          AND s.page_id = p.id
          AND p.slug = 'tools'
          AND st.body LIKE '%' || $1::text || '%'`,
      [
        ToolsPageNoKitchen1796100000000.NEW_INTRO_TAIL,
        ToolsPageNoKitchen1796100000000.OLD_INTRO_TAIL,
      ],
    );
    // Блок, якого вже немає, повертається лише якщо його ще нема, — і з
    // тією самою `variant: 'aside'`, що засіяла стара міграція.
    const page: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM pages WHERE slug = 'tools'`,
    );
    if (page.length === 0) return;
    const has: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count
         FROM page_sections s
         JOIN page_section_translations st ON st.section_id = s.id
        WHERE s.page_id = $1 AND st.body = $2::text`,
      [page[0].id, ToolsPageNoKitchen1796100000000.OLD_CLOSING],
    );
    if (Number(has[0]?.count ?? 0) > 0) return;
    const row: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO page_sections (page_id, sort, type, variant, visible)
       VALUES ($1, 3, 'prose', 'aside', true) RETURNING id`,
      [page[0].id],
    );
    await queryRunner.query(
      `INSERT INTO page_section_translations (section_id, language_code, body, items)
       VALUES ($1, 'en', $2, '[]'::jsonb)`,
      [row[0].id, ToolsPageNoKitchen1796100000000.OLD_CLOSING],
    );
  }
}
