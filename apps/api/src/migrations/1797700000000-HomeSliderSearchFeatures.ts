import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Головна: слайдер, пошукове поле й рядки «текст + фото» — CAMP-488.
 *
 * 🔴 ЦЕ ДАНІ, А НЕ КОД, І САМЕ В ЦЬОМУ ЗМІСТ КАРТКИ. Власник сказав прямо:
 * усе, що бачить читач, правиться в адмінці. Тому слайдер, віджет і
 * фічі — рядки `page_sections` ТОЇ САМОЇ таблиці, що вже тримає головну
 * (CAMP-362), а не нова колекція: ліміт Directus 25, прод стоїть на 24,
 * тож ця міграція НЕ додає жодної таблиці (`\dt` до й після однаковий).
 * Нові лише ЗНАЧЕННЯ поля `type`: `slide`, `search`, `image-text`.
 *
 * 🔴 ОДИН СЛАЙД — ОДИН РЯДОК, А НЕ МАСИВ У `items`. Заголовок, текст,
 * напис і адреса кнопки, картинка та її опис — звичайні поля секції;
 * редактор бачить їх як поля, а не як JSON, де зайва кома прибирає
 * секцію. Слайдів можна додати чи прибрати рівно стільки, скільки
 * хочеться, — додаванням і видаленням рядка.
 *
 * 🔴 ТРИ СЛАЙДИ — ТРИ ВХОДИ ВОРОНКИ, І КОЖЕН ВЕДЕ НА ІСНУЮЧУ СТОРІНКУ.
 * «Знайти кемпінг» → /camping, «Спланувати поїздку» → /plan, «Орендувати
 * кемпер» → /camper-rental. Усі три адреси — ті самі, на які вже ведуть
 * картки головної (`HomeDriveCards`) і меню; жодна не нова. Текст кожного
 * слайда — переказ того, що ТА СТОРІНКА справді каже про себе у своєму
 * `description`; нічого понад це читачеві не обіцяно.
 *
 * 🔴 КАРТИНКИ — НАЯВНІ `public/banners/*.webp`, І ВОНИ ДЕКОРАТИВНІ.
 * `image_alt` порожній навмисно: це згенеровані зображення, що не
 * показують жодного реального місця (`docs/image-sources.md`,
 * `llms.txt`), тож опис «табір над озером» був би твердженням про те,
 * чого ніхто не відвідував. Порожній alt для читача екрана означає
 * «прикраса», і так воно й є.
 *
 * 🔴 ЧОГО ТУТ НЕМАЄ НАВМИСНО: слів про те, як ми заробляємо, чого в нас
 * немає чи ким це написано. Кожен рядок каже, що читач знайде за
 * кнопкою.
 *
 * Слоти (`slide-1`…, `search`, `feature-…`) існують не для сторінки — її
 * макет шукає секції за ТИПОМ, — а щоб міграція була ідемпотентною й
 * відкочуваною: `UNIQUE (page_id, slot)` не дасть вставити двічі.
 */
export class HomeSliderSearchFeatures1797700000000
  implements MigrationInterface
{
  name = 'HomeSliderSearchFeatures1797700000000';

  /** Усе, що ця міграція кладе, — щоб `down` знав, що забирати. */
  static readonly ROWS: ReadonlyArray<{
    slot: string;
    sort: number;
    type: string;
    variant: string | null;
    imageUrl: string | null;
    ctaHref: string;
    heading: string;
    subheading: string | null;
    body: string | null;
    ctaLabel: string;
  }> = [
    {
      slot: 'slide-1',
      sort: 100,
      type: 'slide',
      variant: null,
      imageUrl: '/banners/eu-dawn.webp',
      ctaHref: '/camping',
      subheading: 'Where to stay',
      heading: 'Find your next campsite',
      body: 'Pick a country, then a region, and see every campsite in it with the distance to the nearest lake, town and railway stop.',
      ctaLabel: 'Find a campsite',
    },
    {
      slot: 'slide-2',
      sort: 101,
      type: 'slide',
      variant: null,
      imageUrl: '/banners/lake.webp',
      ctaHref: '/plan',
      subheading: 'Which way to drive',
      heading: 'Plan the drive, night by night',
      body: 'Set a start and an end in the EU and get a campsite for each night, with the reason it was chosen.',
      ctaLabel: 'Plan a trip',
    },
    {
      slot: 'slide-3',
      sort: 102,
      type: 'slide',
      variant: null,
      imageUrl: '/banners/camper.webp',
      ctaHref: '/camper-rental',
      subheading: 'What to drive',
      heading: 'Know what you are renting',
      body: 'Which licence covers the vehicle, what it may weigh once loaded, tolls, insurance and cross-border rules.',
      ctaLabel: 'Rent a camper',
    },
    {
      slot: 'search',
      sort: 110,
      type: 'search',
      variant: null,
      imageUrl: null,
      ctaHref: '/search',
      subheading: 'Name, region or a place nearby',
      heading: 'Search campsites',
      body: null,
      ctaLabel: 'Search',
    },
    {
      slot: 'feature-map',
      sort: 120,
      type: 'image-text',
      variant: null,
      imageUrl: '/banners/about.webp',
      ctaHref: '/map',
      subheading: 'Map',
      heading: 'Every campsite, on one map',
      body: 'Pan and zoom across the EU, or browse by country.',
      ctaLabel: 'Open the map',
    },
    {
      slot: 'feature-routes',
      sort: 121,
      type: 'image-text',
      variant: 'reverse',
      imageUrl: '/banners/routes.webp',
      ctaHref: '/routes',
      subheading: 'Routes',
      heading: 'Camping routes across the EU',
      body: 'Curated routes, stage by stage: what each one is for, and the campsites near every stop.',
      ctaLabel: 'See the routes',
    },
    {
      slot: 'feature-guides',
      sort: 122,
      type: 'image-text',
      variant: null,
      imageUrl: '/banners/guides.webp',
      ctaHref: '/guides',
      subheading: 'Guides',
      heading: 'A guide to each region',
      body: 'What the campsite data says about a region: what is there, and what is near it.',
      ctaLabel: 'Read the guides',
    },
    {
      slot: 'feature-tools',
      sort: 123,
      type: 'image-text',
      variant: 'reverse',
      imageUrl: '/banners/tools.webp',
      ctaHref: '/tools',
      subheading: 'Tools',
      heading: 'Tools for a camper trip',
      body: 'Work out what a trip costs, with fuel priced from the European Commission’s weekly bulletin, and build a packing list.',
      ctaLabel: 'Open the tools',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 🔴 ШУКАЄМО ЗА СЛАГОМ, А НЕ ЗА ТИПОМ — так само, як `HomeDriveCards`:
    // у головної `slug = 'home'` і `type = 'page'`.
    const page = await queryRunner.query(
      `SELECT id FROM pages WHERE slug = 'home' LIMIT 1`,
    );
    // 🔴 ВІДСУТНЯ СТОРІНКА — ПАДІННЯ, А НЕ ТИХИЙ ПРОПУСК: міграція, що
    // мовчки нічого не зробила, читається як виконана.
    if (page.length === 0) {
      throw new Error(
        'HomeSliderSearchFeatures: сторінки зі slug = home немає. ' +
          'Секції нема куди класти, і мовчки пропустити це не можна.',
      );
    }
    const pageId: string = page[0].id;

    for (const r of HomeSliderSearchFeatures1797700000000.ROWS) {
      // Ідемпотентність: повторний прогін не плодить другу копію, а й не
      // перезаписує те, що власник уже виправив в адмінці.
      const already = await queryRunner.query(
        `SELECT id FROM page_sections WHERE page_id = $1 AND slot = $2`,
        [pageId, r.slot],
      );
      if (already.length > 0) continue;

      const section = await queryRunner.query(
        `INSERT INTO page_sections
           (page_id, slot, sort, type, variant, visible, image_url, cta_href)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7)
         RETURNING id`,
        [pageId, r.slot, r.sort, r.type, r.variant, r.imageUrl, r.ctaHref],
      );
      await queryRunner.query(
        `INSERT INTO page_section_translations
           (section_id, language_code, heading, subheading, body, cta_label, items)
         VALUES ($1, 'en', $2, $3, $4, $5, '[]'::jsonb)`,
        [section[0].id, r.heading, r.subheading, r.body, r.ctaLabel],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const slots = HomeSliderSearchFeatures1797700000000.ROWS.map((r) => r.slot);
    // 🔴 ЛИШЕ СТОРІНКА `home`: слот `search` чи `feature-…` міг зʼявитись
    // на іншій сторінці, і відкат головної не мусить їх зачепити.
    await queryRunner.query(
      `DELETE FROM page_section_translations
        WHERE section_id IN (
          SELECT s.id FROM page_sections s
            JOIN pages p ON p.id = s.page_id
           WHERE p.slug = 'home' AND s.slot = ANY($1))`,
      [slots],
    );
    await queryRunner.query(
      `DELETE FROM page_sections
        WHERE page_id IN (SELECT id FROM pages WHERE slug = 'home')
          AND slot = ANY($1)`,
      [slots],
    );
  }
}
