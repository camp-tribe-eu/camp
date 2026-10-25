import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// CAMP-365 — правові документи з бази (`legal_pages` + переклади).
//
// 🔴 ЧОМУ ЦЕ НЕ `PagesService`. Правовий документ має версію, дату
// набуття чинності й статус, і текст його не можна «перенести
// приблизно»: ці поля живуть у власних таблицях (CAMP-87), а не в
// `pages`. Один сервіс на дві моделі змусив би гілкувати кожен запит
// за типом, і гілка, яку забули, віддала б правовий текст без версії.

/**
 * 🔴 «ВИДИМИЙ ЧИТАЧЕВІ» — ОДИН ПРЕДИКАТ НА ОБИДВА ЗАПИТИ.
 *
 * Чернетка правового документа назовні не виходить НІКОЛИ: це текст,
 * який ще не затверджено, і його поява на публічній адресі була б
 * опублікованою неправдою. Предикат тут константою, а не двома
 * однаковими рядками в двох запитах, бо перелік і окремий документ
 * мусять бачити ОДНУ множину: розійдуться — збірка згенерує сторінку
 * для документа, якого окремий запит уже не віддасть, або навпаки.
 *
 * `archived` і `review` теж не видно: опубліковано лише `published`.
 */
const PUBLISHED = `lp.status = 'published'`;

/** Документ без тіла — для переліку. */
export interface LegalSummary {
  slug: string;
  title: string;
  /**
   * «Якщо коротко» (GDPR ст. 12). Колонка допускає `null`, і цей файл
   * не вирішує, що з цим робити: порожнє віддається порожнім, а
   * рішення — друкувати, ні чи падати — ухвалює споживач.
   */
  summary: string | null;
  version: string;
  /** `YYYY-MM-DD`, як у базі, без часового поясу. */
  effectiveFrom: string | null;
}

export interface LegalDocument extends LegalSummary {
  /** Розмітка CMS із якорями заголовків (`## Назва {#id}`). */
  body: string | null;
}

interface Row {
  slug: string;
  title: string;
  plain_summary: string | null;
  version: string;
  effective_from: string | null;
  body: string | null;
}

@Injectable()
export class LegalService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * Опубліковані документи, без тіла.
   *
   * 🔴 ПОРЯДОК — ЗА СЛАГОМ, А НЕ «ЯК ТРЕБА ЧИТАЧЕВІ». У `legal_pages`
   * немає колонки порядку, а порядок у підвалі навмисний (див.
   * `lib/legal.ts` у вебі), тож його тримає той, хто його вигадав, —
   * реєстр. Вдавати тут, що база його знає, означало б віддати
   * порядок, якого ніхто не обирав.
   *
   * 🔴 Документ без перекладу запитаною мовою ВИПАДАЄ, а не стає
   * порожнім — з тієї ж причини, що й у `PagesService.bySlug`:
   * заголовок без тексту читач прочитає як «сторінка зламана».
   */
  async list(language: string): Promise<LegalSummary[]> {
    const rows = await this.db.query<Row[]>(
      `SELECT lp.slug, lp.version,
              to_char(lp.effective_from, 'YYYY-MM-DD') AS effective_from,
              t.title, t.plain_summary
         FROM legal_pages lp
         JOIN legal_page_translations t
           ON t.legal_page_id = lp.id AND t.language_code = $1
        WHERE ${PUBLISHED}
        ORDER BY lp.slug`,
      [language],
    );
    return rows.map(summaryOf);
  }

  /** Документ із тілом, або `null`, якщо його немає серед опублікованих. */
  async bySlug(slug: string, language: string): Promise<LegalDocument | null> {
    const rows = await this.db.query<Row[]>(
      `SELECT lp.slug, lp.version,
              to_char(lp.effective_from, 'YYYY-MM-DD') AS effective_from,
              t.title, t.plain_summary, t.body
         FROM legal_pages lp
         JOIN legal_page_translations t
           ON t.legal_page_id = lp.id AND t.language_code = $2
        WHERE lp.slug = $1
          AND ${PUBLISHED}
        LIMIT 1`,
      [slug, language],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...summaryOf(row), body: row.body };
  }
}

function summaryOf(r: Row): LegalSummary {
  return {
    slug: r.slug,
    title: r.title,
    summary: r.plain_summary,
    version: r.version,
    effectiveFrom: r.effective_from,
  };
}
