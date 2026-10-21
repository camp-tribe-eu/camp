import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-365 — головна: вступ і «як це працює» переїжджають у CMS.
 *
 * 🔴 ЧОМУ НЕ ВСЯ СТОРІНКА, І ЦЕ НЕ НЕДОРОБКА.
 *
 * Головна — це МАКЕТ, а не документ: редакційні рядки вплетені в
 * обчислене (перелік країн, картки місць, числа кемпінгів). Межа та
 * сама, що на /tools: текст, який ОПИСУЄ, їде в CMS; те, що РАХУЄ або
 * ПЕРЕЛІЧУЄ згенероване, лишається з генератором.
 *
 * Цим кроком їде справжня копірайтерська частина — заголовок, вступний
 * абзац і три кроки «як це працює».
 *
 * 🔴 БЛОК ДВОХ КАРТОК («Where to stay» / «What to drive») ЛИШАЄТЬСЯ В
 * КОДІ НАВМИСНО. Це сітка з двох колонок, у лівій — перелік країн із
 * бази, у правій — абзац. Щоб перенести її, потрібен був би тип секції
 * на КОЖНЕ гніздо макета, а це рівно той патерн «унікальних секцій»,
 * який CAMP-362 відхилила. Окремий крок, не цей.
 *
 * 🔴 `{{lead}}` — ПІДСТАНОВКА, А НЕ ТЕКСТ. Перше речення вступу будує
 * `heroLead()`, і вона СВІДОМО не друкує чисел, коли API віддав нулі
 * (урок CAMP-308: «61 422» колись застигло в тексті). Цей запобіжник
 * лишається в коді; у базі стоїть лише хвіст речення.
 */
export class SeedHomePage1792700000000 implements MigrationInterface {
  name = 'SeedHomePage1792700000000';

  private readonly slug = 'home';

  /** Дослівно з попереднього `app/page.tsx`. */
  private readonly h1 = 'Every campsite, and what is around it';

  private readonly lead =
    '{{lead}}, each with the distance to water, to the nearest town and to a railway stop, its elevation and its terrain — calculated by us, published by nobody else.';

  private readonly steps = [
    {
      term: 'Find places',
      text: 'Campsites from OpenStreetMap, refreshed weekly, with the gaps shown as gaps rather than filled in with guesses.',
    },
    {
      term: 'See the surroundings',
      text: 'How far the lake is, how high the site sits, whether a train stops within walking distance — computed for every campsite.',
    },
    {
      term: 'Plan the drive',
      text: 'Route planning and weather along the way are being built. Nothing here pretends they are ready.',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1`,
      [this.slug],
    );
    if (Number(existing[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), -1, false)
       RETURNING id`,
      [this.slug],
    );
    const pageId = page[0].id;

    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_description)
       VALUES ($1, 'en', $2, $3)`,
      [
        pageId,
        this.h1,
        'Campsites, motorhome parks and camper stops across the EU-27, with what is around each one.',
      ],
    );

    const add = async (
      sort: number,
      type: string,
      t: { heading?: string; body?: string; items?: unknown },
    ) => {
      const row: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO page_sections (page_id, sort, type, visible)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [pageId, sort, type],
      );
      await queryRunner.query(
        `INSERT INTO page_section_translations
           (section_id, language_code, heading, body, items)
         VALUES ($1, 'en', $2, $3, $4)`,
        [
          row[0].id,
          t.heading ?? null,
          t.body ?? null,
          JSON.stringify(t.items ?? []),
        ],
      );
    };

    await add(0, 'hero', { heading: this.h1, body: this.lead });
    await add(1, 'steps', { heading: 'How this works', items: this.steps });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE slug = $1)`,
      [this.slug],
    );
    await queryRunner.query(`DELETE FROM pages WHERE slug = $1`, [this.slug]);
  }
}
