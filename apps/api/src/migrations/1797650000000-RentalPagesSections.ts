import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Хаб оренди, сторінка країни й сторінка компаній — секції в CMS (CAMP-461).
 *
 * Власник (CAMP-443/444): сторінки оренди — «просто інформаційні», без
 * банера, без картинок, без заклику до дії. Макет тепер малює код
 * (`apps/web/src/app/camper-rental/**`), а ВЕСЬ текст, який бачить читач
 * поверх нього, — заголовки, абзаци, підписи кнопок, питання й відповіді
 * акордеона — лежить тут, у `page_sections`, тобто правиться в Directus.
 *
 * 🔴 НОВИХ КОЛЕКЦІЙ НЕМАЄ. Прод стоїть на 24 із 25 зареєстрованих; ця
 * міграція додає ЛИШЕ РЯДКИ в `pages`, `page_translations`, `page_sections`
 * і `page_section_translations`, які вже зареєстровані. Типи секцій
 * (`hero`, `cta`, `prose`, `steps`, `faq`, `image-text`) — значення
 * `varchar`, а не схема.
 *
 * 🔴 МЕЖА «ТЕКСТ ОПИСУЄ — У БАЗУ, ТЕКСТ РАХУЄ — ЗАЛИШАЄТЬСЯ З ГЕНЕРАТОРОМ»
 * тримається й тут: речення з числом компаній, числом кемпінгів і датою
 * заміру лишаються в коді (число, набране в базі, застаріє мовчки).
 *
 * 🔴 БЕЗ «ВНУТРІШНЬОЇ КУХНІ». Жодного рядка про те, чого в нас немає,
 * про партнерів, про заробіток і про плани. Ціни не вказані, і тут
 * сказано лише ПРАКТИЧНУ причину: вони залежать від дат і сезону.
 *
 * Ідемпотентна: сторінка або слот, що вже є, не перезаписується (власник
 * міг їх відредагувати), тож повторний прогін нічого не ламає.
 */

interface Section {
  slot: string;
  type: string;
  variant?: string;
  imageUrl?: string;
  ctaHref?: string;
  heading?: string;
  subheading?: string;
  body?: string;
  imageAlt?: string;
  ctaLabel?: string;
  items?: Array<{ term: string; text: string }>;
}

interface PageSeed {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription?: string;
  noindex: boolean;
  sections: Section[];
}

const HUB: PageSeed = {
  slug: 'camper-rental',
  title: 'Renting a camper in the EU',
  metaTitle: 'Renting a camper in the EU',
  metaDescription:
    'Choose a camper rental company in the EU and know what the hire commits you to: the 3.5 tonne licence line, toll classes set by height, payload, cross-border rules and the questions that decide the bill.',
  noindex: false,
  sections: [
    {
      slot: 'banner',
      type: 'hero',
      heading: 'Renting a camper in the EU',
      subheading: 'CAMPER RENTAL',
      body: 'Compare the companies that hand over campers in the EU, and know what the hire commits you to before you sign: the licence line, tolls, cross-border rules and the costs that appear at the counter.',
      ctaHref: '/camper-rental/providers',
      ctaLabel: 'Choose a rental company',
    },
    {
      slot: 'picker',
      type: 'cta',
      heading: 'Find a rental company',
      body: 'Choose where you pick the camper up and what kind you want. We show the companies that match.',
      ctaHref: '/camper-rental/providers',
      ctaLabel: 'Show rental companies',
    },
    {
      slot: 'providers',
      type: 'prose',
      heading: 'Rental companies',
      body: 'Depots, fleet size, services and the vehicle types each company says it offers, with the source and the date we checked it beside every figure. Prices change with dates and season, so each company’s own page has the current ones.',
      ctaHref: '/camper-rental/providers',
      ctaLabel: 'Compare all rental companies',
    },
    {
      slot: 'mass-line',
      type: 'steps',
      heading: 'Almost everything changes at 3 500 kg',
      body: 'One number, stamped on the vehicle, decides four separate things. The details are in the questions at the bottom of the page.',
      items: [
        {
          term: 'Your licence',
          text: 'Category B covers motor vehicles up to 3 500 kg. Above that you need C1, a separate medical and a separate test.',
        },
        {
          term: 'Your tolls',
          text: 'Austria and Slovenia sell their vignettes up to 3 500 kg. Above it, distance-based tolling with an on-board unit applies.',
        },
        {
          term: 'Your winter equipment',
          text: 'Sweden draws its winter-tyre rules at 3.5 tonnes, with a longer season for heavier vehicles.',
        },
        {
          term: 'Your payload',
          text: 'A motor caravan’s mass in running order already counts a driver and a nearly full fuel tank. Fresh water weighs a kilogram a litre.',
        },
      ],
    },
    {
      slot: 'countries',
      type: 'prose',
      heading: 'Rules and costs, country by country',
      body: 'Each country page covers what is true there and not next door: tolls, winter rules, where you may sleep, and what our own campsite records say about it.',
    },
    {
      slot: 'story:0',
      type: 'image-text',
      imageUrl: '/banners/routes.webp',
      imageAlt: 'A gravel path winding through a misty pine forest',
      subheading: 'Plan',
      heading: 'Plan the route before you pick the camper',
      body: 'Ready-made camper routes show the stages, the campsites on the way and what a litre costs along them. Choose a route first, then size the vehicle to it.',
      ctaHref: '/routes',
      ctaLabel: 'Browse camper routes',
    },
    {
      slot: 'story:1',
      type: 'image-text',
      variant: 'reverse',
      imageUrl: '/banners/tools.webp',
      imageAlt:
        'Camping gear on a groundsheet: a kettle, a coil of rope, a folded blanket and a wooden mallet',
      subheading: 'Calculate',
      heading: 'Know what the trip will cost',
      body: 'The trip cost calculator prices diesel from the European Commission’s weekly bulletin for every member state and asks you for the campsite fee. Add the hire price from the company and you have the budget.',
      ctaHref: '/tools/camper-trip-cost',
      ctaLabel: 'Open the trip cost calculator',
    },
    {
      slot: 'story:2',
      type: 'image-text',
      imageUrl: '/banners/lake.webp',
      imageAlt: 'A lake in morning mist with reeds in the foreground',
      subheading: 'Stay',
      heading: 'Find a campsite that suits a camper',
      body: 'Search and map the campsites we have across the EU, and see what each one records: electricity hook-up, drinking water, grey-water disposal.',
      ctaHref: '/search',
      ctaLabel: 'Search campsites',
    },
    {
      slot: 'story:3',
      type: 'image-text',
      variant: 'reverse',
      imageUrl: '/banners/guides.webp',
      imageAlt:
        'A closed notebook and a pencil beside a steaming enamel mug on a wooden table',
      subheading: 'Read',
      heading: 'Read before you go',
      body: 'The blog goes deeper into the practical side of camper travel, starting with what changes above 3 500 kg.',
      ctaHref: '/blog',
      ctaLabel: 'Read the blog',
    },
    {
      slot: 'faq',
      type: 'faq',
      heading: 'Questions people ask before they book',
      items: [
        {
          term: 'What changes at 3 500 kg?',
          text: 'The maximum authorised mass stamped on the vehicle decides four things at once. Your licence: category B covers motor vehicles up to 3 500 kg, and above that you need C1, a separate medical and a separate test (Directive 2006/126/EC, Article 4(4)). Your tolls: Austria sells its vignette to camper vans up to 3.5 tonnes and Slovenia its e-vignette to vehicles up to 3 500 kilograms; above that you are in the distance-based systems built for lorries, with an on-board unit obtained in advance. Even the newest Dutch toll, on a four-kilometre link outside Rotterdam, draws its tariff at the same line and names campers in it. Your winter equipment: Sweden asks vehicles up to 3.5 t for winter tyres from 1 December to 31 March when conditions demand, and heavier ones from 10 November to 10 April whatever the weather; Austria and Slovenia draw the same line for what has to be fitted where. Your payload: the mass in running order of a motor caravan already counts a 75 kg driver and a nearly full fuel tank, and fresh water weighs a kilogram a litre, so a full tank can be a third of what is left. Regulation (EU) No 1230/2012 sets the masses and dimensions. A member state may transpose the detail differently, and its own transport authority has the last word.',
        },
        {
          term: 'Why are there no prices on this page?',
          text: 'Hire prices depend on the dates, the season, the vehicle and the mileage, and they change from week to week, so a figure copied here would be out of date by the time you read it. The rental company’s own page shows the current price. What we can price is fuel: the trip cost calculator uses the European Commission’s weekly bulletin, dated, and asks you for the campsite fee.',
        },
        {
          term: 'What most often costs more than expected at the counter?',
          text: 'Four things. The insurance excess, which the headline damage waiver rarely takes to zero and which commonly excludes the roof, the awning, the tyres and the underside. One-way fees, quoted after the rest of the booking is agreed. A mileage cap that looked generous for one country and is not for a loop through four. And camera-enforced charges — Italian limited traffic zones, the Dublin M50, Swedish congestion tax — which reach the rental company as registered keeper and are passed on, usually with an administration fee.',
        },
      ],
    },
  ],
};

const COUNTRY_TEMPLATE: PageSeed = {
  slug: 'camper-rental-country',
  title: 'Camper rental country page',
  metaTitle: 'Camper rental country page',
  noindex: true,
  sections: [
    {
      slot: 'cta',
      type: 'cta',
      heading: 'Choose a rental company',
      body: 'See the companies that hand over campers here, with their depots, fleet and services.',
      ctaHref: '/camper-rental/providers',
      ctaLabel: 'Compare rental companies',
    },
    {
      slot: 'before',
      type: 'prose',
      heading: 'Before you book',
    },
    {
      slot: 'story:0',
      type: 'image-text',
      imageUrl: '/banners/routes.webp',
      imageAlt: 'A gravel path winding through a misty pine forest',
      subheading: 'Plan',
      heading: 'Plan the route, then the camper',
      body: 'Ready-made camper routes show the stages, the campsites on the way and what a litre costs along them.',
      ctaHref: '/routes',
      ctaLabel: 'Browse camper routes',
    },
    {
      slot: 'story:1',
      type: 'image-text',
      variant: 'reverse',
      imageUrl: '/banners/guides.webp',
      imageAlt:
        'A closed notebook and a pencil beside a steaming enamel mug on a wooden table',
      subheading: 'Read',
      heading: 'Read before you go',
      body: 'The blog goes deeper into the practical side of camper travel, starting with what changes above 3 500 kg.',
      ctaHref: '/blog',
      ctaLabel: 'Read the blog',
    },
  ],
};

const PROVIDERS: PageSeed = {
  slug: 'camper-rental-providers',
  title: 'Camper rental companies',
  metaTitle: 'Camper rental in the EU: companies, services and fleet',
  metaDescription:
    'Camper rental companies in the European Union, with the services and fleet each one lists. Every fact carries its source and the date it was checked.',
  noindex: false,
  sections: [
    {
      slot: 'banner',
      type: 'hero',
      heading: 'Camper rental companies',
      subheading: 'COMPARE',
      body: 'Compare the companies that hand over campers in the EU: depots, fleet size, services and the vehicle types each one lists.',
      ctaHref: '/camper-rental/providers#companies',
      ctaLabel: 'Browse the companies',
    },
    {
      slot: 'intro',
      type: 'prose',
      heading: 'How to read the figures',
      body: 'Depot and fleet figures are what each company states about itself; the source and the date we checked it stand next to every figure on the company’s own page. Prices are not listed, because they depend on dates and season: the company’s page has the current ones.',
    },
    {
      slot: 'story:0',
      type: 'image-text',
      imageUrl: '/banners/tools.webp',
      imageAlt:
        'Camping gear on a groundsheet: a kettle, a coil of rope, a folded blanket and a wooden mallet',
      subheading: 'Calculate',
      heading: 'Know what the trip will cost',
      body: 'The trip cost calculator prices diesel from the European Commission’s weekly bulletin and asks you for the campsite fee. Add the hire price from the company and you have the budget.',
      ctaHref: '/tools/camper-trip-cost',
      ctaLabel: 'Open the trip cost calculator',
    },
    {
      slot: 'story:1',
      type: 'image-text',
      variant: 'reverse',
      imageUrl: '/banners/routes.webp',
      imageAlt: 'A gravel path winding through a misty pine forest',
      subheading: 'Plan',
      heading: 'Plan the route before you pick the camper',
      body: 'Ready-made camper routes show the stages, the campsites on the way and what a litre costs along them.',
      ctaHref: '/routes',
      ctaLabel: 'Browse camper routes',
    },
  ],
};

const PAGES: PageSeed[] = [HUB, COUNTRY_TEMPLATE, PROVIDERS];

export class RentalPagesSections1797650000000 implements MigrationInterface {
  name = 'RentalPagesSections1797650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const page of PAGES) {
      const found: Array<{ id: string }> = await queryRunner.query(
        `SELECT id FROM pages WHERE slug = $1 AND type = 'page'`,
        [page.slug],
      );
      let pageId = found[0]?.id;
      if (!pageId) {
        const row: Array<{ id: string }> = await queryRunner.query(
          `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
           VALUES ($1, 'page', 'published', now(), 1, $2) RETURNING id`,
          [page.slug, page.noindex],
        );
        pageId = row[0].id;
        await queryRunner.query(
          `INSERT INTO page_translations
             (page_id, language_code, title, meta_title, meta_description)
           VALUES ($1, 'en', $2, $3, $4)`,
          [pageId, page.title, page.metaTitle, page.metaDescription ?? null],
        );
      } else if (page.metaDescription) {
        // Хаб уже мав рядок (CAMP-478); опис у нього був `null`. Не
        // перезаписуємо, якщо власник уже щось вписав.
        await queryRunner.query(
          `UPDATE page_translations SET meta_description = $2
            WHERE page_id = $1 AND language_code = 'en'
              AND meta_description IS NULL`,
          [pageId, page.metaDescription],
        );
      }

      const existing: Array<{ slot: string; sort: number }> =
        await queryRunner.query(
          `SELECT slot, sort FROM page_sections WHERE page_id = $1`,
          [pageId],
        );
      const have = new Set(existing.map((e) => e.slot));
      // Існуючий `intro` хаба (CAMP-478) лишається першим; нові секції
      // ідуть за ним у порядку списку.
      let sort = existing.reduce((m, e) => Math.max(m, e.sort), 0);

      for (const s of page.sections) {
        if (have.has(s.slot)) continue;
        sort += 1;
        const sec: Array<{ id: string }> = await queryRunner.query(
          `INSERT INTO page_sections
             (page_id, sort, type, slot, variant, image_url, cta_href, visible)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
          [
            pageId,
            sort,
            s.type,
            s.slot,
            s.variant ?? null,
            s.imageUrl ?? null,
            s.ctaHref ?? null,
          ],
        );
        await queryRunner.query(
          `INSERT INTO page_section_translations
             (section_id, language_code, heading, subheading, body,
              image_alt, cta_label, items)
           VALUES ($1, 'en', $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            sec[0].id,
            s.heading ?? null,
            s.subheading ?? null,
            s.body ?? null,
            s.imageAlt ?? null,
            s.ctaLabel ?? null,
            JSON.stringify(s.items ?? []),
          ],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Лише те, що додала ця міграція: слоти за іменем, а не весь рядок
    // сторінки хаба (його `intro` належить CAMP-478).
    for (const page of PAGES) {
      const slots = page.sections.map((s) => s.slot);
      await queryRunner.query(
        `DELETE FROM page_sections
          WHERE page_id IN (SELECT id FROM pages WHERE slug = $1 AND type = 'page')
            AND slot = ANY($2)`,
        [page.slug, slots],
      );
      if (page.slug !== 'camper-rental') {
        await queryRunner.query(
          `DELETE FROM page_translations
            WHERE page_id IN (SELECT id FROM pages WHERE slug = $1 AND type = 'page')`,
          [page.slug],
        );
        await queryRunner.query(
          `DELETE FROM pages WHERE slug = $1 AND type = 'page'`,
          [page.slug],
        );
      }
    }
  }
}
