import { QueryRunner } from 'typeorm';
import { SeedLegalPages1792800000000 } from '../migrations/1792800000000-SeedLegalPages';

/**
 * Спільне для міграцій, що міняють текст одного правового документа
 * (CAMP-365): три випадки в `up`, відкат у `down`, і заміни в тексті, які
 * падають, а не мовчать.
 *
 * 🔴 ЧОМУ ЦЕ ОКРЕМИЙ ФАЙЛ, А НЕ КОПІЯ З `PrivacyRetentionLogs`. Чотири
 * правові сторінки (terms, cookies, database, notice) правляться однією
 * карткою, і чотири копії однієї логіки «що робити, коли в базі чужий
 * текст» розійшлися б при першій правці. Поведінка та сама, що в
 * політиці приватності 2.1–2.3, слово в слово за наслідками:
 *
 *   · у базі ПОПЕРЕДНІЙ текст → оновити;
 *   · у базі вже ЦЕЙ текст і ця версія → нічого (повторний прогін чистий);
 *   · у базі ІНШЕ → падіння з назвою: правовий документ мовчки не
 *     перезаписується, бо хтось міг відредагувати його в CMS.
 *
 * Не `migrations/`: туди дивиться TypeORM, і файл без класу-міграції там —
 * зайвий шум для `check-migration-stamps`.
 */
export interface LegalPageDoc {
  slug: string;
  title: string;
  summary: string;
  version: string;
  effectiveFrom: string;
  body: string;
}

/** Сторінка так, як її лишив посів, — береться з його міграції, не передруковується. */
export function seededPage(slug: string): LegalPageDoc {
  const pages = (
    new SeedLegalPages1792800000000() as unknown as { pages: LegalPageDoc[] }
  ).pages;
  const page = pages.find((p) => p.slug === slug);
  if (!page) {
    throw new Error(
      `legal-update: посів не несе «${slug}». Посіяно: ${pages
        .map((p) => p.slug)
        .join(', ')}.`,
    );
  }
  return { ...page };
}

/**
 * Замінити рівно одне входження. Нуль або більше одного — падіння з
 * назвою якоря: заміна, що тихо не спрацювала, лишила б у базі стару
 * неправду з піднятою версією.
 */
export function replaceOnce(
  text: string,
  anchor: string,
  replacement: string,
): string {
  const n = text.split(anchor).length - 1;
  if (n !== 1) {
    throw new Error(
      `legal-update: якір «${anchor.slice(0, 80)}…» стоїть ${n} разів, ` +
        'а має стояти рівно один: попередній текст не той, який ця міграція знає.',
    );
  }
  return text.replace(anchor, () => replacement);
}

/**
 * Замінити відрізок від `from` до кінця `to` включно. Обидва якорі —
 * рівно по одному разу, і `to` після `from`; інакше падіння.
 */
export function replaceSpan(
  text: string,
  from: string,
  to: string,
  replacement: string,
): string {
  for (const anchor of [from, to]) {
    const n = text.split(anchor).length - 1;
    if (n !== 1) {
      throw new Error(
        `legal-update: якір «${anchor.slice(0, 80)}…» стоїть ${n} разів, ` +
          'а має стояти рівно один.',
      );
    }
  }
  const start = text.indexOf(from);
  const end = text.indexOf(to) + to.length;
  if (text.indexOf(to) < start) {
    throw new Error(
      `legal-update: «${to.slice(0, 40)}…» стоїть раніше за «${from.slice(0, 40)}…».`,
    );
  }
  return text.slice(0, start) + replacement + text.slice(end);
}

export async function applyLegalUpdate(
  queryRunner: QueryRunner,
  page: LegalPageDoc,
  previous: LegalPageDoc,
): Promise<void> {
  const rows: Array<{ id: string; version: string; body: string | null }> =
    await queryRunner.query(
      `SELECT lp.id, lp.version, t.body
         FROM legal_pages lp
         LEFT JOIN legal_page_translations t
           ON t.legal_page_id = lp.id AND t.language_code = 'en'
        WHERE lp.slug = $1`,
      [page.slug],
    );
  const row = rows[0];
  if (row === undefined || row.body === null) {
    throw new Error(
      `legal_pages «${page.slug}»: немає рядка з англійським текстом, який ця ` +
        `міграція має оновити з ${previous.version} до ${page.version}. ` +
        'Його мала створити міграція 1792800000000.',
    );
  }
  const body: string = row.body;
  if (body === page.body && row.version === page.version) return;
  if (body !== previous.body) {
    throw new Error(
      `legal_pages «${page.slug}» містить текст, якого ця міграція не знає ` +
        `(${body.length} символів, версія ${row.version}; очікувала ` +
        `${previous.version}, ${previous.body.length} символів). Правовий ` +
        'документ не перезаписується мовчки: вирішіть, чия редакція чинна, ' +
        `і або приведіть базу до ${previous.version}, або внесіть правку в ` +
        `текст ${page.version} цієї міграції.`,
    );
  }
  await queryRunner.query(
    `UPDATE legal_page_translations SET title = $2, plain_summary = $3, body = $4
      WHERE legal_page_id = $1 AND language_code = 'en'`,
    [row.id, page.title, page.summary, page.body],
  );
  await queryRunner.query(
    `UPDATE legal_pages SET version = $2, effective_from = $3 WHERE id = $1`,
    [row.id, page.version, page.effectiveFrom],
  );
}

export async function revertLegalUpdate(
  queryRunner: QueryRunner,
  page: LegalPageDoc,
  previous: LegalPageDoc,
): Promise<void> {
  // 🔴 Повертаємо лише те, що самі поклали: чужий текст не чіпаємо.
  const rows: Array<{ id: string }> = await queryRunner.query(
    `SELECT lp.id
       FROM legal_pages lp
       JOIN legal_page_translations t
         ON t.legal_page_id = lp.id AND t.language_code = 'en'
      WHERE lp.slug = $1 AND t.body = $2`,
    [page.slug, page.body],
  );
  if (rows.length === 0) return;
  await queryRunner.query(
    `UPDATE legal_page_translations SET title = $2, plain_summary = $3, body = $4
      WHERE legal_page_id = $1 AND language_code = 'en'`,
    [rows[0].id, previous.title, previous.summary, previous.body],
  );
  await queryRunner.query(
    `UPDATE legal_pages SET version = $2, effective_from = $3 WHERE id = $1`,
    [rows[0].id, previous.version, previous.effectiveFrom],
  );
}
