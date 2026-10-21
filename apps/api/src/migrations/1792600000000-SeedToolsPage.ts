import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-365 — /tools переїжджає в CMS частково, і межа тут предметна.
 *
 * 🔴 ЩО САМЕ ЛИШАЄТЬСЯ В КОДІ Й ЧОМУ.
 *
 * Сторінка змішує текст із ОБЧИСЛЕНИМ: дата паливного бюлетеня і
 * перелік 27 країн, що генерується з `FUEL_COUNTRIES` — того самого
 * джерела, з якого робляться самі сторінки й карта сайту. Коментар на
 * сторінці казав це прямо: так перелік «не може назвати сторінку, якої
 * немає, або пропустити одну».
 *
 * Межа: **текст, що ОПИСУЄ сторінку, їде в CMS; текст, що РАХУЄ або
 * ПЕРЕЛІЧУЄ згенероване, лишається з генератором.** Тому секція
 * `fuel-countries` тримає в базі лише заголовок і підпис, а самі
 * посилання малює рендер.
 *
 * 🔴 ДВІ РІЗНІ МОВИ ПІДСТАНОВОК, і це навмисно. `{{fuel.bulletin}}` у
 * тексті розгортає загальний білий список (`PAGE_VALUES`), бо значення
 * одне на весь застосунок. А `{{count}}` і `{{bulletin}}` у підписі до
 * переліку країн розгортає САМ рендер — лише він знає, скільки їх
 * сьогодні.
 */
export class SeedToolsPage1792600000000 implements MigrationInterface {
  name = 'SeedToolsPage1792600000000';

  private readonly slug = 'tools';

  private readonly intro =
    'Both are free and need no account. Where a number comes from a measurement, the page says which measurement and when — the trip cost calculator is built on fuel prices published by the European Commission for the week of {{fuel.bulletin}}, and its table of all 27 countries is served as plain HTML, so it reads without JavaScript.';

  private readonly closing =
    'A camper comparison tool was planned alongside these. It needs rental models and prices from partners we have not integrated yet, and a comparison assembled from numbers we made up would undo the point of the other two. It arrives when the data does.';

  /** Дослівно з попереднього `TOOLS` у `app/tools/page.tsx`. */
  private readonly cards = [
    {
      href: '/tools/camper-trip-cost',
      title: 'What does a camper trip cost?',
      body: 'Fuel priced from the European Commission’s weekly bulletin, for all 27 member states. Campsite prices are yours to enter — we hold none, and say so.',
      terms: [
        {
          term: 'You give it',
          text: 'The country, diesel or petrol, your vehicle and what it burns, the distance, the nights, the people, and what you expect a pitch to cost.',
        },
        {
          term: 'You get',
          text: 'A total in which the part that comes from a published measurement is kept apart from the part that comes from you.',
        },
        {
          term: 'What it does not know',
          text: 'What any campsite charges. We hold no pitch prices, so leave the field empty and the total is fuel only.',
        },
      ],
    },
    {
      href: '/tools/camper-packing-list',
      title: 'Camper packing list',
      body: 'Built from how you travel, ticked off as you go, and shareable with whoever is loading the van.',
      terms: [
        {
          term: 'You give it',
          text: 'The vehicle, the season, the nights and the people — and whether you cook, have mains electricity, travel with children or with a dog.',
        },
        {
          term: 'You get',
          text: 'A list in groups, with a quantity wherever one follows from your answers, and the ticks kept in the link you share.',
        },
        {
          term: 'What it does not know',
          text: 'What you are legally required to carry. Those rules differ between member states and change, so they are not on the list, and the page says so.',
        },
      ],
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
       VALUES ($1, 'page', 'published', now(), 2, false)
       RETURNING id`,
      [this.slug],
    );
    const pageId = page[0].id;

    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_description)
       VALUES ($1, 'en', $2, $3)`,
      [
        pageId,
        'Tools',
        'Free tools for planning a camper trip: what it costs with this week’s real EU fuel prices, and what to pack.',
      ],
    );

    const add = async (
      sort: number,
      type: string,
      t: { body?: string; heading?: string; items?: unknown; variant?: string },
    ) => {
      const row: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO page_sections (page_id, sort, type, variant, visible)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [pageId, sort, type, t.variant ?? null],
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

    await add(0, 'prose', { body: this.intro });
    await add(1, 'cards', { items: this.cards });
    await add(2, 'fuel-countries', {
      heading: 'Fuel prices, country by country',
      body: 'One page for each of the {{count}} member states, priced with that country’s fuel for the week of {{bulletin}}.',
    });
    // 🔴 `variant: 'aside'` — щоб абзац лишився таким, як був:
    // відбитим донизу й приглушеним (`mt-10 … text-ink-3`). Без нього
    // він дістав би типові класи й опинився впритул до переліку країн.
    // Посимвольна звірка цього не ловить: текст той самий, вигляд ні.
    await add(3, 'prose', { body: this.closing, variant: 'aside' });
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
