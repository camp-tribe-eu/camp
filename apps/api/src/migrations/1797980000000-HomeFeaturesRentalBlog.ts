import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Головна: ще два рядки «текст + фото» — оренда й блог (CAMP-441/16).
 *
 * Ревʼю 16.11: «Блогу, оренди секцією з фото … немає» серед секцій головної.
 * Це ДАНІ, а не код (як і CAMP-488, `HomeSliderSearchFeatures`): два рядки
 * `page_sections` тієї самої сторінки `home`, нових таблиць нуль. Власник
 * міняє текст, фото й порядок в адмінці.
 *
 * 🔴 ФОТО НЕ ПОВТОРЮЮТЬ ТЕ, ЩО ВЖЕ Є НА ГОЛОВНІЙ. `camper.webp` стоїть у
 * третьому слайді, тож для оренди взято фото теми «motorhome» (кемпер на
 * майданчику), а для блогу — `tent.webp`, якого на головній немає.
 *
 * 🔴 ТЕКСТ КАЖЕ ЛИШЕ ТЕ, ЩО Є ЗА КНОПКОЮ. Сторінка компаній оренди справді
 * фільтрує за країною отримання й типом машини; три дописи блогу справді про
 * сезони, туристичний збір і електрику з газом.
 *
 * Слоти — для ідемпотентності: `UNIQUE (page_id, slot)`.
 */
export class HomeFeaturesRentalBlog1797980000000 implements MigrationInterface {
  name = 'HomeFeaturesRentalBlog1797980000000';

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
      slot: 'feature-rental',
      sort: 124,
      type: 'image-text',
      variant: null,
      imageUrl: '/photos/topic/motorhome.webp',
      ctaHref: '/camper-rental/providers',
      subheading: 'Camper rental',
      heading: 'Rent a camper in the EU',
      body: 'Rental companies side by side: the countries you can pick up in, the vehicles they rent and what each one includes.',
      ctaLabel: 'Compare rental companies',
    },
    {
      slot: 'feature-blog',
      sort: 125,
      type: 'image-text',
      variant: 'reverse',
      imageUrl: '/banners/tent.webp',
      ctaHref: '/blog',
      subheading: 'Blog',
      heading: 'Notes for the road',
      body: 'When to go, what tourist taxes and campsite fees add up to, and how electricity and gas work on a pitch.',
      ctaLabel: 'Read the blog',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const page = await queryRunner.query(
      `SELECT id FROM pages WHERE slug = 'home' LIMIT 1`,
    );
    if (page.length === 0) {
      throw new Error('HomeFeaturesRentalBlog: сторінки зі slug = home немає.');
    }
    const pageId: string = page[0].id;
    for (const r of HomeFeaturesRentalBlog1797980000000.ROWS) {
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
    const slots = HomeFeaturesRentalBlog1797980000000.ROWS.map((r) => r.slot);
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
