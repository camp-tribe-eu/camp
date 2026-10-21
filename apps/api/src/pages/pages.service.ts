import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// CAMP-365 — сторінка, зібрана з універсальних секцій (модель CAMP-362).

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
  items: unknown[];
}

export interface PageView {
  slug: string;
  title: string;
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
   * 🔴 `null` ОЗНАЧАЄ «НЕМАЄ», А НЕ «ПОРОЖНЯ». Сторінка без перекладу
   * обраною мовою — це теж «немає»: показати заголовок без тексту
   * гірше, ніж чесний 404, бо читач вирішить, що сторінка зламана, а
   * пошуковик проіндексує порожнечу.
   *
   * 🔴 СЕКЦІЇ БЕЗ ПЕРЕКЛАДУ ВИПАДАЮТЬ, А НЕ СТАЮТЬ ПОРОЖНІМИ. Те саме
   * міркування на рівень нижче: порожня секція це дірка в сторінці, а
   * не секція.
   */
  async bySlug(slug: string, language: string): Promise<PageView | null> {
    const pages = await this.db.query<
      Array<{
        id: string;
        slug: string;
        noindex: boolean;
        title: string;
        meta_description: string | null;
      }>
    >(
      `
      SELECT p.id, p.slug, p.noindex, t.title, t.meta_description
        FROM pages p
        JOIN page_translations t
          ON t.page_id = p.id
         AND t.language_code = $2
       WHERE p.slug = $1
       LIMIT 1
      `,
      [slug, language],
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
        items: Array.isArray(r.items) ? r.items : [],
      })),
    };
  }

  /** Слаги всіх сторінок — для `generateStaticParams`. */
  async slugs(language: string): Promise<string[]> {
    const rows = await this.db.query<Array<{ slug: string }>>(
      `SELECT p.slug
         FROM pages p
         JOIN page_translations t
           ON t.page_id = p.id AND t.language_code = $1
        ORDER BY p.sort, p.slug`,
      [language],
    );
    return rows.map((r) => r.slug);
  }
}
