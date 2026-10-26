import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чотири готові розділи, яких не було в меню — тому читач їх не знаходив.
 *
 * 🔴 ЧОМУ ЦЕ НЕ «ЗАБУЛИ», А УМОВА, ЯКА ЩОЙНО ВИКОНАЛАСЬ.
 *
 * `SeedNavigation1792300000000` свідомо НЕ переносила `/routes` і
 * `/rentals`: коментар там каже «додаються, коли кожен поїде, не
 * раніше», бо сторінок тоді не існувало, і пункт меню вів би в нікуди.
 *
 * Заміряно 25.10.2026 — сторінки є:
 *   /routes          12 кураторських маршрутів (CURATED_ROUTES)
 *   /camper-rental   12 країн (publishableCountries)
 *   /blog            каталог, сторінка поста, пагінація
 *   /about           сторінка з CMS
 *
 * Усі чотири мали НУЛЬ або майже нуль вхідних посилань: `/about` і
 * `/camper-rental` — жодного, `/blog` — лише з самого допису, `/routes`
 * — лише з `/plan` і `/search`, а ті обидва під `noindex`. Тобто чотири
 * зроблені розділи були недосяжні для читача й для пошуку.
 *
 * 🔴 Сторожем лишається `navigation.e2e-spec.ts`: він бере КОЖЕН пункт
 * із бази й перевіряє, що той відкривається. Без нього база дозволила б
 * вписати пункт на неіснуючу сторінку — саме цього боялась попередня
 * міграція.
 *
 * Порядок у шапці стає десятипунктовим. Це багато, і групування —
 * рішення власника; знайти розділ зараз важливіше, ніж охайність.
 */
export class NavAddFourLinks1793000000000 implements MigrationInterface {
  name = 'NavAddFourLinks1793000000000';

  private readonly items: Array<[string, string]> = [
    ['/routes', 'Routes'],
    ['/camper-rental', 'Camper rental'],
    ['/blog', 'Blog'],
    ['/about', 'About'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 🔴 Ідемпотентно і по кожному пункту окремо: міграція може йти на
    // базі, де частину вже додали руками в CMS. Дубль у меню читач
    // побачив би одразу.
    const next: Array<{ max: string | null }> = await queryRunner.query(
      `SELECT max(sort)::text AS max FROM navigation WHERE location = 'header'`,
    );
    let sort = Number(next[0]?.max ?? -1) + 1;

    for (const [href, label] of this.items) {
      const seen: Array<{ count: string }> = await queryRunner.query(
        `SELECT count(*)::text AS count FROM navigation WHERE location = 'header' AND href = $1`,
        [href],
      );
      if (Number(seen[0]?.count ?? 0) > 0) continue;

      const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO navigation (location, sort, href, visible)
         VALUES ('header', $1, $2, true) RETURNING id`,
        [sort, href],
      );
      await queryRunner.query(
        `INSERT INTO navigation_translations (navigation_id, language_code, label)
         VALUES ($1, 'en', $2)`,
        [inserted[0].id, label],
      );
      sort += 1;
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [href] of this.items) {
      await queryRunner.query(
        `DELETE FROM navigation_translations WHERE navigation_id IN (
           SELECT id FROM navigation WHERE location = 'header' AND href = $1)`,
        [href],
      );
      await queryRunner.query(
        `DELETE FROM navigation WHERE location = 'header' AND href = $1`,
        [href],
      );
    }
  }
}
