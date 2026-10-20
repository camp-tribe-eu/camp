import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-365 — меню переїжджає з коду в базу.
 *
 * 🔴 ЩО САМЕ ПЕРЕНЕСЕНО, І ЧОМУ РІВНО ЦЕ.
 *
 * Шість пунктів шапки, дослівно з `site-chrome.tsx`. Там же лежали
 * ДВА закоментовані — `/routes` (CAMP-45) і `/rentals` (CAMP-54), — і
 * вони сюди НЕ їдуть: коментар поруч казав «додаються, коли кожен
 * поїде, не раніше», а сторінок досі немає. Перенести їх означало б
 * опублікувати два мертві посилання в головному меню.
 *
 * 🔴 І ЧОГО МИ ЦИМ ПЕРЕЇЗДОМ ПОЗБУВАЄМОСЬ.
 *
 * Доки список жив у коді, мертве посилання було НЕМОЖЛИВЕ: щоб його
 * додати, треба було змінити файл, а файл читає рецензія і CI. База
 * цієї властивості не має — власник може вписати пункт на сторінку,
 * якої немає, і ніщо не впаде.
 *
 * Тому поруч стоїть `navigation.e2e-spec.ts`, який бере КОЖЕН пункт із
 * бази й перевіряє, що він відкривається. Без нього цей переїзд був би
 * обміном «власник не може редагувати» на «власник може зламати».
 *
 * Підвал сюди не їде цією міграцією: його правові посилання
 * генеруються з `LEGAL_PAGES`, і той список сам є сторожем — сторінка,
 * додана в нього, не може не існувати. Це окремий крок картки.
 */
export class SeedNavigation1792300000000 implements MigrationInterface {
  name = 'SeedNavigation1792300000000';

  // Дослівно з `apps/web/src/components/site-chrome.tsx`, у тому ж порядку.
  private readonly header: Array<[string, string]> = [
    ['/map', 'Map'],
    ['/camping', 'Campsites'],
    ['/search', 'Search'],
    ['/plan', 'Plan a trip'],
    ['/guides', 'Guides'],
    ['/tools', 'Tools'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 🔴 Ідемпотентно: міграція може прогнатись на базі, де рядки вже
    // є (наприклад, після відкату й повтору). Дубль пункту меню читач
    // побачив би одразу, і це виглядало б як дефект рендера.
    const existing: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM navigation WHERE location = 'header'`,
    );
    if (Number(existing[0]?.count ?? 0) > 0) return;

    for (const [index, [href, label]] of this.header.entries()) {
      const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO navigation (location, sort, href, visible)
         VALUES ('header', $1, $2, true)
         RETURNING id`,
        [index, href],
      );
      await queryRunner.query(
        `INSERT INTO navigation_translations (navigation_id, language_code, label)
         VALUES ($1, 'en', $2)`,
        [inserted[0].id, label],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Переклади підуть каскадом — зовнішній ключ має ON DELETE CASCADE.
    await queryRunner.query(`DELETE FROM navigation WHERE location = 'header'`);
  }
}
