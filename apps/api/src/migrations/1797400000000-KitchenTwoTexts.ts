import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-463, друге коло: два тексти в CMS, що ще розповідали читачеві
 * про нашу кухню. Обидва живуть у базі, тому міграція, а не правка коду.
 *
 *   головна, крок «Plan the drive»:
 *     «Route planning and weather along the way are being built.
 *      Nothing here pretends they are ready.»
 *   → розповідь про те, чого в нас немає. Тепер — про те, що Є:
 *     «Routes across the EU, stop by stop, with the campsites and
 *      services nearest each stop.» (сторінка /routes існує й каже
 *     саме це).
 *
 *   примітка про походження допису блогу:
 *     «This article was composed by AI. …» → «…was written by AI. …»
 *
 * 🔴 ПРИМІТКУ ПРО ШІ НЕ ПРИБРАНО, ЛИШЕ ПЕРЕПИСАНО ЛЮДСЬКИМИ СЛОВАМИ.
 * Вона — розкриття машинного тексту (ст. 50 AI Act), і
 * `check-post-provenance` вимагає її в кожному дописі. Чи лишати її
 * взагалі — рішення власника, не цієї міграції.
 *
 * 🔴 ТОЧКОВО Й ІДЕМПОТЕНТНО (так само, як `ToolsPageNoKitchen`): шукається
 * ДОСЛІВНИЙ старий текст, взятий із міграцій, що його засіяли. Якщо
 * власник уже переписав абзац в адмінці — збігу нема, і його правку
 * ніхто не перезаписує.
 */
export class KitchenTwoTexts1797400000000 implements MigrationInterface {
  name = 'KitchenTwoTexts1797400000000';

  /** Дослівно з `SeedHomePage`. */
  static readonly OLD_HOME_STEP =
    'Route planning and weather along the way are being built. Nothing here pretends they are ready.';
  static readonly NEW_HOME_STEP =
    'Routes across the EU, stop by stop, with the campsites and services nearest each stop.';

  /** Дослівно з `SeedTestBlogPosts`. */
  static readonly OLD_POST_NOTE =
    'This article was composed by AI. It is general background, not a statement about any particular campsite.';
  static readonly NEW_POST_NOTE =
    'This article was written by AI. It is general background, not a statement about any particular campsite.';

  private async swapHome(q: QueryRunner, from: string, to: string) {
    // `items` — jsonb; текст кроку не має символів, що екрануються в JSON.
    await q.query(
      `UPDATE page_section_translations st
          SET items = replace(st.items::text, $1::text, $2::text)::jsonb
         FROM page_sections s, pages p
        WHERE st.section_id = s.id
          AND s.page_id = p.id
          AND p.slug = 'home' AND p.type = 'page'
          AND strpos(st.items::text, $1::text) > 0`,
      [from, to],
    );
  }

  private async swapPostNote(q: QueryRunner, from: string, to: string) {
    await q.query(
      `UPDATE page_section_translations st
          SET body = $2::text
         FROM page_sections s, pages p
        WHERE st.section_id = s.id
          AND s.page_id = p.id
          AND p.type = 'post'
          AND s.variant = 'provenance'
          AND st.body = $1::text`,
      [from, to],
    );
  }

  public async up(q: QueryRunner): Promise<void> {
    await this.swapHome(
      q,
      KitchenTwoTexts1797400000000.OLD_HOME_STEP,
      KitchenTwoTexts1797400000000.NEW_HOME_STEP,
    );
    await this.swapPostNote(
      q,
      KitchenTwoTexts1797400000000.OLD_POST_NOTE,
      KitchenTwoTexts1797400000000.NEW_POST_NOTE,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await this.swapHome(
      q,
      KitchenTwoTexts1797400000000.NEW_HOME_STEP,
      KitchenTwoTexts1797400000000.OLD_HOME_STEP,
    );
    await this.swapPostNote(
      q,
      KitchenTwoTexts1797400000000.NEW_POST_NOTE,
      KitchenTwoTexts1797400000000.OLD_POST_NOTE,
    );
  }
}
