import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// CAMP-365 — сторінка, зібрана з універсальних секцій (модель CAMP-362).
// CAMP-364 — дописи блогу їдуть тією самою моделлю, інший лише `type`.

/**
 * 🔴 «ВИДИМИЙ ЧИТАЧЕВІ» ОЗНАЧЕНО ОДИН РАЗ І ВСТАВЛЯЄТЬСЯ В УСІ ЗАПИТИ.
 *
 * Для сторінок вистачало `status = 'published'`. Для ДОПИСІВ цього
 * мало: `published_at` існує саме щоб допис зʼявився в призначений
 * час, і запит без цього предиката віддав би завтрашній допис уже
 * сьогодні — тихо, бо на дошці він «опублікований».
 *
 * Предикат тут константою, а не трьома однаковими рядками в трьох
 * запитах: перелік, сторінка і карта сайту МУСЯТЬ бачити одну множину.
 * Розійдуться — дістанемо мертві адреси (сторінка є в переліку, а
 * `bySlug` на неї віддає 404) або, гірше, ранній допис в індексі.
 *
 * `published_at IS NULL` лишається видимим: для сторінок дати немає й
 * не передбачено, і вимагати її означало б сховати всі сторінки.
 */
const VISIBLE = `p.status = 'published'
          AND (p.published_at IS NULL OR p.published_at <= now())`;

/** Рядок переліку дописів — усе, що потрібно картці в блозі. */
export interface PostSummary {
  slug: string;
  title: string;
  /** Короткий опис; `meta_description` допису, якщо є. */
  summary: string | null;
  /** ISO-8601 або `null`, якщо дати немає. */
  publishedAt: string | null;
  authorName: string | null;
}

export interface SectionView {
  type: string;
  variant: string | null;
  heading: string | null;
  subheading: string | null;
  body: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  ctaHref: string | null;
  ctaLabel: string | null;
  /** Сире значення `jsonb`: перевіряє рендер, а не цей файл. */
  items: unknown;
}

export interface PageView {
  slug: string;
  title: string;
  /** Заголовок для пошуковика; `null` → береться `title`. */
  metaTitle: string | null;
  metaDescription: string | null;
  noindex: boolean;
  sections: SectionView[];
}

@Injectable()
export class PagesService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * Сторінка з секціями, або `null`, якщо її немає.
   *
   * 🔴 ЛИШЕ `published`, І ЛИШЕ ЗАПИТАНОГО ТИПУ.
   *
   * Перша редакція не мала предиката на `status` ВЗАГАЛІ — і це не
   * дрібниця: сид клав сторінку з DEFAULT `'draft'`, тож чернетка
   * їхала читачеві й у `generateStaticParams`. Рецензія заміряла:
   * `status='archived'` віддавалось так само. Сусідній
   * `guides.service.ts:62` робить це правильно з коментарем «Only
   * published rows ever leave this file» — я мав його поруч і не
   * подивився.
   *
   * 🔴 І `type`: `ContentModel` обіцяє, що сторінка й допис з однаковим
   * слагом «зіткнутись не можуть», а запит без типу мав `LIMIT 1` без
   * `ORDER BY` — тобто переможець довільний. Тепер тип питається явно.
   *
   * 🔴 `null` ОЗНАЧАЄ «НЕМАЄ», А НЕ «ПОРОЖНЯ». Сторінка без перекладу
   * обраною мовою — це теж «немає»: показати заголовок без тексту
   * гірше, ніж чесний 404, бо читач вирішить, що сторінка зламана, а
   * пошуковик проіндексує порожнечу.
   *
   * 🔴 СЕКЦІЇ БЕЗ ПЕРЕКЛАДУ ВИПАДАЮТЬ, А НЕ СТАЮТЬ ПОРОЖНІМИ. Те саме
   * міркування на рівень нижче: порожня секція це дірка в сторінці, а
   * не секція.
   */
  async bySlug(
    slug: string,
    language: string,
    type: 'page' | 'post' = 'page',
  ): Promise<PageView | null> {
    const pages = await this.db.query<
      Array<{
        id: string;
        slug: string;
        noindex: boolean;
        title: string;
        meta_title: string | null;
        meta_description: string | null;
      }>
    >(
      `
      SELECT p.id, p.slug, p.noindex, t.title, t.meta_title, t.meta_description
        FROM pages p
        JOIN page_translations t
          ON t.page_id = p.id
         AND t.language_code = $2
       WHERE p.slug = $1
         AND p.type = $3
         AND ${VISIBLE}
       LIMIT 1
      `,
      [slug, language, type],
    );

    const page = pages[0];
    if (!page) return null;

    const rows = await this.db.query<
      Array<{
        type: string;
        variant: string | null;
        image_url: string | null;
        cta_href: string | null;
        heading: string | null;
        subheading: string | null;
        body: string | null;
        image_alt: string | null;
        cta_label: string | null;
        items: unknown[] | null;
      }>
    >(
      `
      SELECT s.type, s.variant, s.image_url, s.cta_href,
             t.heading, t.subheading, t.body, t.image_alt, t.cta_label, t.items
        FROM page_sections s
        JOIN page_section_translations t
          ON t.section_id = s.id
         AND t.language_code = $2
       WHERE s.page_id = $1
         AND s.visible = true
       ORDER BY s.sort
      `,
      [page.id, language],
    );

    return {
      slug: page.slug,
      title: page.title,
      metaTitle: page.meta_title,
      metaDescription: page.meta_description,
      noindex: page.noindex,
      sections: rows.map((r) => ({
        type: r.type,
        variant: r.variant,
        heading: r.heading,
        subheading: r.subheading,
        body: r.body,
        imageUrl: r.image_url,
        imageAlt: r.image_alt,
        ctaHref: r.cta_href,
        ctaLabel: r.cta_label,
        // 🔴 НЕ ЗВОДИМО ДО МАСИВУ. Раніше тут стояло
        // `Array.isArray(r.items) ? r.items : []`, і обʼєкт замість
        // масиву (звичайний наслідок правки jsonb у Directus) тихо
        // ставав порожнім переліком: картки зникали, розмітка казала
        // «0 елементів», і нічого не падало. Сире значення йде далі,
        // а розбирає його рендер — там, де є що сказати читачеві.
        items: r.items,
      })),
    };
  }

  /**
   * Слаги опублікованих сторінок — для `generateStaticParams`.
   *
   * 🔴 Той самий фільтр, що й у `bySlug`, і це НЕ дублювання заради
   * симетрії: без нього збірка згенерувала б сторінку з чернетки, а
   * `bySlug` потім віддав би на неї 404. Два запити мусять бачити одну
   * множину, інакше ми самі собі зробимо мертві адреси.
   */
  async slugs(
    language: string,
    type: 'page' | 'post' = 'page',
  ): Promise<string[]> {
    const rows = await this.db.query<Array<{ slug: string }>>(
      `SELECT p.slug
         FROM pages p
         JOIN page_translations t
           ON t.page_id = p.id AND t.language_code = $1
        WHERE p.type = $2
          AND ${VISIBLE}
        ORDER BY p.sort, p.slug`,
      [language, type],
    );
    return rows.map((r) => r.slug);
  }

  /**
   * Дописи блогу, найсвіжіший першим.
   *
   * 🔴 ПОРЯДОК — ЗА ДАТОЮ, А НЕ ЗА `sort`. Сторінки впорядковує рука
   * (`sort` у меню), дописи — час. Допис без дати стає в кінець, а не
   * на початок: `NULLS LAST` сказано явно, бо типовий порядок Postgres
   * для `DESC` ставить `NULL` ПЕРШИМИ, і найстаріший чернетковий допис
   * очолив би блог.
   */
  async posts(language: string): Promise<PostSummary[]> {
    const rows = await this.db.query<
      Array<{
        slug: string;
        title: string;
        meta_description: string | null;
        published_at: Date | null;
        author_name: string | null;
      }>
    >(
      `SELECT p.slug, p.published_at, p.author_name,
              t.title, t.meta_description
         FROM pages p
         JOIN page_translations t
           ON t.page_id = p.id AND t.language_code = $1
        WHERE p.type = 'post'
          AND ${VISIBLE}
        ORDER BY p.published_at DESC NULLS LAST, p.slug`,
      [language],
    );
    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      summary: r.meta_description,
      publishedAt: r.published_at ? r.published_at.toISOString() : null,
      authorName: r.author_name,
    }));
  }
}
