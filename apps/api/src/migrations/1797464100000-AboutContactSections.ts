import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  ABOUT_PROSE,
  CONTACT_PROSE,
  splitAbout,
  publicContactCard,
  splitContact,
} from '../pages/about-contact-split';

/**
 * CAMP-464 — /about і /contact розкладаються на секції каталогу.
 *
 * Власник: «повтори красу і структуру сторінки про нас з демо-стору» і
 * «контакти — банер нагорі, далі контактна форма й більше інфи». Було:
 * банер, чотири абзаци підряд і кнопка. Стало: «текст + фото», картки зі
 * значками, картка праворуч, FAQ — типи секцій, які рендер навчився малювати
 * в цій самій картці (`page-sections.tsx`).
 *
 * 🔴 ТЕКСТ НЕ ПИШЕТЬСЯ ЗАНОВО, А РІЖЕТЬСЯ З ТОГО, ЩО Є. Абзаци беруться з
 * оригінальних міграцій (`SeedAboutPage`, `SeedContactPage`) — з тих самих
 * полів, а не з переписаних копій. Розрізи йдуть по місцях, де речення
 * вже закінчується, і КОЖЕН розріз перевіряється: зібраний назад текст
 * мусить дорівнювати оригіналу, інакше міграція падає, а не пише
 * переінакшений текст. Нові — лише заголовки й підписи секцій; жодного
 * нового твердження про сервіс.
 *
 * 🔴 ПРАВКУ ВЛАСНИКА НЕ ПЕРЕЗАПИСУЄМО. Сторінка змінюється, ТІЛЬКИ якщо вона
 * досі точно така, якою її поклав оригінальний засів: ті самі дві секції й
 * той самий текст дослівно. Власник міг переписати абзац у Directus —
 * тоді міграція нічого не чіпає й каже про це (NOTICE), бо перезапис
 * чужої правки гірший за сторінку без нових секцій.
 *
 * 🔴 ФОРМИ ЗВОРОТНЬОГО ЗВʼЯЗКУ ТУТ НЕМАЄ. Єдиний відкритий ендпоінт для
 * звернень (`POST /problem-reports`) привʼязаний до кемпінгу; загального
 * немає, а нова форма — нова обробка персональних даних із власним
 * розділом політики. Замість неї картка з кнопкою `mailto:`.
 *
 * 🔴 НІЧОГО НЕ ВИГАДАНО ПРО СЕРВІС. Відповіді FAQ спираються на те, що
 * існує: «Report a problem» на сторінці кемпінгу (`report-problem.tsx`),
 * адреса для питань про дані (`{{privacy.email}}`, політика 2.1) і те, що
 * вже сказано в чотирьох абзацах.
 *
 * Фото — власні банери сайту (`public/banners`), не фото місць.
 */

interface SectionSpec {
  type: string;
  variant?: string;
  slot?: string;
  imageUrl?: string;
  ctaHref?: string;
  heading?: string;
  subheading?: string;
  body?: string;
  imageAlt?: string;
  ctaLabel?: string;
  items?: unknown;
}

async function insertSection(
  q: QueryRunner,
  pageId: string,
  sort: number,
  s: SectionSpec,
): Promise<void> {
  const row: Array<{ id: string }> = await q.query(
    `INSERT INTO page_sections (page_id, sort, type, variant, slot, image_url, cta_href, visible)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
    [
      pageId,
      sort,
      s.type,
      s.variant ?? null,
      s.slot ?? null,
      s.imageUrl ?? null,
      s.ctaHref ?? null,
    ],
  );
  await q.query(
    `INSERT INTO page_section_translations
       (section_id, language_code, heading, subheading, body, image_alt, cta_label, items)
     VALUES ($1, 'en', $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      row[0].id,
      s.heading ?? null,
      s.subheading ?? null,
      s.body ?? null,
      s.imageAlt ?? null,
      s.ctaLabel ?? null,
      // `items` — NOT NULL з типовим `[]`: «немає» це порожній масив.
      JSON.stringify(s.items ?? []),
    ],
  );
}

/**
 * Сторінка, що досі такою, як поклав засів: рівно дві секції, перша —
 * проза з оригінальним текстом. Інакше — `null` (власник її чіпав).
 */
async function untouchedPage(
  q: QueryRunner,
  slug: string,
  originalProse: string,
): Promise<string | null> {
  const page: Array<{ id: string }> = await q.query(
    `SELECT id FROM pages WHERE slug = $1 AND type = 'page'`,
    [slug],
  );
  if (page.length !== 1) return null;
  const sections: Array<{ type: string; body: string | null }> = await q.query(
    `SELECT s.type, t.body
       FROM page_sections s
       LEFT JOIN page_section_translations t
         ON t.section_id = s.id AND t.language_code = 'en'
      WHERE s.page_id = $1
      ORDER BY s.sort`,
    [page[0].id],
  );
  const ok =
    sections.length === 2 &&
    sections[0].type === 'prose' &&
    sections[0].body === originalProse &&
    sections[1].type === 'cta';
  return ok ? page[0].id : null;
}

async function clearSections(q: QueryRunner, pageId: string): Promise<void> {
  await q.query(
    `DELETE FROM page_section_translations
      WHERE section_id IN (SELECT id FROM page_sections WHERE page_id = $1)`,
    [pageId],
  );
  await q.query(`DELETE FROM page_sections WHERE page_id = $1`, [pageId]);
}

export class AboutContactSections1797464100000 implements MigrationInterface {
  name = 'AboutContactSections1797464100000';

  public async up(q: QueryRunner): Promise<void> {
    const about = splitAbout(ABOUT_PROSE);
    const contact = splitContact(CONTACT_PROSE);

    const aboutId = await untouchedPage(q, 'about', ABOUT_PROSE);
    if (aboutId === null) {
      console.log(
        'NOTICE: /about змінено після засіву (або її немає) — секції не чіпаю.',
      );
    } else {
      // Заклик (кнопка + лист) лишається тим, що був: беремо його з бази.
      const cta: Array<{ cta_href: string; cta_label: string; body: string }> =
        await q.query(
          `SELECT s.cta_href, t.cta_label, t.body
             FROM page_sections s
             JOIN page_section_translations t
               ON t.section_id = s.id AND t.language_code = 'en'
            WHERE s.page_id = $1 AND s.type = 'cta'`,
          [aboutId],
        );
      await clearSections(q, aboutId);
      await insertSection(q, aboutId, 0, {
        type: 'image-with-text',
        imageUrl: '/banners/routes.webp',
        imageAlt: 'A gravel road winding through a misty pine forest.',
        subheading: 'What it is',
        heading: 'A directory built from open data',
        body: about.intro,
      });
      await insertSection(q, aboutId, 1, {
        type: 'features',
        heading: 'What you will see on a page',
        items: [
          {
            icon: 'info',
            title: about.uncertainTitle,
            text: about.uncertainText,
          },
          {
            icon: 'clock',
            title: 'Live conditions, from the issuer',
            text: about.liveText,
          },
          {
            icon: 'alert',
            title: 'Old readings are labelled',
            text: about.staleText,
          },
        ],
      });
      await insertSection(q, aboutId, 2, {
        type: 'image-with-text',
        variant: 'image-right',
        imageUrl: '/banners/guides.webp',
        imageAlt: 'A notebook and an enamel mug on a weathered wooden table.',
        subheading: 'Who runs it',
        heading: 'Operated by {{company.name}}',
        body: about.operator,
      });
      await insertSection(q, aboutId, 3, {
        type: 'cta',
        ctaHref: cta[0].cta_href,
        ctaLabel: cta[0].cta_label,
        body: cta[0].body,
      });
    }

    const contactId = await untouchedPage(q, 'contact', CONTACT_PROSE);
    if (contactId === null) {
      console.log(
        'NOTICE: /contact змінено після засіву (або її немає) — секції не чіпаю.',
      );
    } else {
      const cta: Array<{ cta_href: string; cta_label: string }> = await q.query(
        `SELECT s.cta_href, t.cta_label
           FROM page_sections s
           JOIN page_section_translations t
             ON t.section_id = s.id AND t.language_code = 'en'
          WHERE s.page_id = $1 AND s.type = 'cta'`,
        [contactId],
      );
      await clearSections(q, contactId);
      await insertSection(q, contactId, 0, {
        type: 'prose',
        variant: 'lead',
        slot: 'intro',
        heading: 'Get in touch',
        body: contact.intro,
      });
      await insertSection(q, contactId, 1, {
        type: 'features',
        variant: 'stack',
        // 🔴 Слот на сторінці УНІКАЛЬНИЙ (`UQ_page_sections_page_slot`):
        // кожне місце — одна секція. Тому вступ і контакти — два місця
        // однієї лівої колонки, а не два блоки в одному.
        slot: 'details',
        items: [
          {
            icon: 'mail',
            title: 'Email',
            text: '{{contact.email}}',
            href: 'mailto:{{contact.email}}',
          },
          {
            icon: 'shield',
            title: 'Questions about your data',
            text: '{{privacy.email}}',
            href: 'mailto:{{privacy.email}}',
          },
        ],
      });
      await insertSection(q, contactId, 2, {
        type: 'card',
        slot: 'aside',
        heading: 'Before you write',
        body: publicContactCard(contact.card),
        ctaHref: cta[0].cta_href,
        ctaLabel: cta[0].cta_label,
      });
      await insertSection(q, contactId, 3, {
        type: 'faq',
        heading: 'Quick answers',
        items: [
          {
            term: 'A campsite page has something wrong. What do I do?',
            text: 'Open that campsite’s page and use “Report a problem”, or write to the address above.',
          },
          {
            term: 'Who do I write to about my personal data?',
            text: 'To {{privacy.email}}. What we store and for how long is set out on the privacy page.',
          },
          {
            term: 'Where are the company details?',
            text: 'On the legal notice: company details and the supervisory authority.',
          },
        ],
      });
      await insertSection(q, contactId, 4, {
        type: 'prose',
        variant: 'aside',
        body: contact.operator,
      });
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    // 🔴 Назад — до оригінального засіву, але ТІЛЬКИ для сторінки, яку ми
    // самі розклали: перша секція `image-with-text`/`prose lead`. Правку
    // власника, зроблену після міграції, відкат не топче.
    for (const [slug, firstType] of [
      ['about', 'image-with-text'],
      ['contact', 'prose'],
    ] as const) {
      const page: Array<{ id: string }> = await q.query(
        `SELECT id FROM pages WHERE slug = $1 AND type = 'page'`,
        [slug],
      );
      if (page.length !== 1) continue;
      const first: Array<{ type: string; variant: string | null }> =
        await q.query(
          `SELECT type, variant FROM page_sections
            WHERE page_id = $1 ORDER BY sort LIMIT 1`,
          [page[0].id],
        );
      const ours =
        first[0]?.type === firstType &&
        (slug === 'about' || first[0].variant === 'lead');
      if (!ours) continue;

      const cta: Array<{
        cta_href: string;
        cta_label: string;
        body: string | null;
      }> = await q.query(
        `SELECT s.cta_href, t.cta_label, t.body
             FROM page_sections s
             JOIN page_section_translations t
               ON t.section_id = s.id AND t.language_code = 'en'
            WHERE s.page_id = $1 AND s.cta_href IS NOT NULL
            ORDER BY s.sort DESC LIMIT 1`,
        [page[0].id],
      );
      await clearSections(q, page[0].id);
      await insertSection(q, page[0].id, 0, {
        type: 'prose',
        body: slug === 'about' ? ABOUT_PROSE : CONTACT_PROSE,
      });
      await insertSection(q, page[0].id, 1, {
        type: 'cta',
        ctaHref: cta[0].cta_href,
        ctaLabel: cta[0].cta_label,
        body: slug === 'about' ? (cta[0].body ?? undefined) : undefined,
      });
    }
  }
}
