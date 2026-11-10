import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Країни оренди з бази — CAMP-479.
 *
 * Текст (назва, кут, вступ, підвід до заміру, факти з джерелами) живе в
 * `pages` з `type = 'rental-country'`; слаг сторінки — код країни.
 *
 * 🔴 ТУТ НЕМАЄ `data.metric`, `data.kind` І `definiteArticle`, І ЦЕ НЕ
 * ПРОПУСК. Вони лишились у коді вебу: перші два обирають ОБЧИСЛЕННЯ
 * заміру, а не показуються читачеві, третій — англійська граматика
 * назви. Редактор, що змінив би `metric`, зламав би сторінку, а не
 * текст; тож цього важеля в нього бути не повинно.
 *
 * 🔴 РОЛЬ СЕКЦІЇ ЧИТАЄТЬСЯ ЗІ `slot`, А НЕ З НОМЕРА. Редактор має право
 * переставити факти місцями — і має: порядок фактів це редакційне
 * рішення. Складання за `sort` віддало б вступ там, де чекають підвід.
 */

export interface RentalFactView {
  title: string;
  body: string;
  source: { name: string; url: string };
}

export interface RentalCountryView {
  code: string;
  name: string;
  angle: string;
  intro: string;
  dataIntro: string;
  facts: RentalFactView[];
}

interface SectionRow {
  slot: string | null;
  heading: string | null;
  body: string | null;
  items: unknown;
}

interface CountryRow {
  code: string;
  title: string | null;
  meta_description: string | null;
  sections: SectionRow[] | null;
}

const SQL = `
  SELECT p.slug AS code,
         t.title,
         t.meta_description,
         (SELECT json_agg(json_build_object(
                   'slot', s.slot, 'heading', st.heading,
                   'body', st.body, 'items', st.items)
                 ORDER BY s.sort)
            FROM page_sections s
            JOIN page_section_translations st
              ON st.section_id = s.id AND st.language_code = $1
           WHERE s.page_id = p.id AND s.visible) AS sections
    FROM pages p
    JOIN page_translations t
      ON t.page_id = p.id AND t.language_code = $1
   WHERE p.type = 'rental-country' AND p.status = 'published'`;

@Injectable()
export class RentalCountriesService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async all(language = 'en'): Promise<RentalCountryView[]> {
    const rows: CountryRow[] = await this.db.query(`${SQL} ORDER BY p.slug`, [
      language,
    ]);
    return rows.map(toView);
  }

  async byCode(
    code: string,
    language = 'en',
  ): Promise<RentalCountryView | null> {
    const rows: CountryRow[] = await this.db.query(
      `${SQL} AND p.slug = $2 LIMIT 1`,
      [language, code],
    );
    return rows[0] ? toView(rows[0]) : null;
  }
}

function bySlot(sections: SectionRow[], slot: string): SectionRow | undefined {
  return sections.find((s) => s.slot === slot);
}

function toView(r: CountryRow): RentalCountryView {
  const sections = r.sections ?? [];

  // 🔴 ФАКТИ БЕРУТЬСЯ ЗА ПРЕФІКСОМ І СОРТУЮТЬСЯ ЧИСЛОМ, А НЕ РЯДКОМ.
  // `fact:10` при сортуванні рядком стає між `fact:1` і `fact:2`. Трьох
  // фактів на країну це не зачепило б — і саме тому помилка дочекалась
  // би десятого факту й першого ж читача.
  const facts = sections
    .filter((s) => (s.slot ?? '').startsWith('fact:'))
    .sort(
      (a, b) =>
        Number((a.slot ?? '').slice(5)) - Number((b.slot ?? '').slice(5)),
    )
    .map((s) => {
      const raw = Array.isArray(s.items) ? s.items : [];
      const first = raw[0] as { term?: unknown; detail?: unknown } | undefined;
      return {
        title: s.heading ?? '',
        body: s.body ?? '',
        source: {
          name: typeof first?.term === 'string' ? first.term : '',
          url: typeof first?.detail === 'string' ? first.detail : '',
        },
      };
    });

  return {
    code: r.code,
    name: r.title ?? r.code,
    angle: r.meta_description ?? '',
    intro: bySlot(sections, 'intro')?.body ?? '',
    dataIntro: bySlot(sections, 'data-intro')?.body ?? '',
    facts,
  };
}
