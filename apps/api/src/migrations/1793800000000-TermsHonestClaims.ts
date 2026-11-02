import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  applyLegalUpdate,
  replaceOnce,
  replaceSpan,
  revertLegalUpdate,
  seededPage,
} from '../pages/legal-update';

/**
 * Умови 1.1 → 1.2: три твердження, які сторінка робила про сайт, а сайт
 * цього не робив (розбіжності, знайдені читанням 01.11.2026).
 *
 * 🔴 ЩО БУЛО НЕПРАВДОЮ І ЩО ЗАМІРЯНО.
 *
 *  1. §4 обіцяла приймати «a correction, a photograph, a review». Код
 *     приймає одне: текст повідомлення про помилку через форму
 *     «Report a problem». Завантажень файлів немає (жодного інтерсептора
 *     завантаження, жодного файлового поля форми — нуль у `apps/web/src` і
 *     `apps/api/src`; тримають `no-upload-routes.spec.ts` в API й
 *     `legal-terms-claims.spec.tsx` у вебі), відгуків немає,
 *     `const photos: Photo[] = []`. Перелік звужено до того, що є.
 *     🔴 І ліцензійне речення поруч («you give us permission to publish it
 *     here») ПРИБРАНО: скарги не публікуються (API не має жодного GET для
 *     них), тож воно стверджувало б ліцензію на те, чого ми не робимо.
 *     Сторінка тепер каже «We do not publish it», а формулювання дозволу
 *     повернеться разом із першим, що ми справді публікуємо від читачів.
 *  2. §6 посилалась на публічний репозиторій як місце попередніх
 *     редакцій. Тексти тепер у базі (CAMP-365), у git лежить лише посів.
 *     Замінено на те, що ми справді можемо зробити: зберігаємо самі й
 *     надсилаємо на запит редакцію, чинну в названий день.
 *  3. §4 казала «We ask you to confirm your age», а запиту немає: галочки
 *     нема (`account.service.ts`: «Terms have no box»), є абзац над кнопкою
 *     реєстрації — «By creating an account you confirm that you are
 *     eighteen or older». Тепер сторінка каже саме це.
 *
 * 🔴 ТЕКСТ ГЕНЕРУЄТЬСЯ ІЗ ПОПЕРЕДНЬОГО ТРЬОМА ЗАМІНАМИ, кожна з перевіркою
 * на єдиність якоря (`replaceOnce`): чужа редакція в базі не піддається
 * тихо. Три випадки в `up` — ті самі, що в політиці приватності.
 * `pages/legal-seeded.ts` накладає це тіло на посів для тестів, а версію й
 * дату підіймає реєстр `lib/legal.ts` — разом із цією міграцією.
 *
 * 🔴 КОЖНЕ ТВЕРДЖЕННЯ ТУТ ЗВІРЯЄ З КОДОМ `apps/web/tests/unit/
 * legal-terms-claims.spec.ts`.
 */
export class TermsHonestClaims1793800000000 implements MigrationInterface {
  name = 'TermsHonestClaims1793800000000';

  /** Те, що 1.1 поклав у базу посів, — береться з його міграції. */
  readonly previous = seededPage('terms');

  readonly page = (() => {
    let body = this.previous.body;
    // 3. Вік: що справді відбувається при реєстрації.
    body = replaceOnce(
      body,
      'We ask you to confirm your age. We do not ask for your date of birth,',
      'Creating an account is your confirmation that you are eighteen or older: the sign-up form says so in a sentence above the button, and there is no box to tick. We do not ask for your date of birth,',
    );
    // 1. Що ми приймаємо сьогодні — одне, і не публікуємо його.
    //
    // 🔴 ЦЕЙ АБЗАЦ ПЕРЕПИСАНО ЦІЛИМ, а не одне речення в ньому. Перша редакція
    // цієї правки звужувала лише перелік («a correction, a photograph, a
    // review» → звіт про помилку) і лишала поруч «you give us permission to
    // publish it here … you confirm that publishing it breaks nobody else’s
    // rights». Разом вони казали: ми беремо в читача ліцензію ОПУБЛІКУВАТИ
    // його скаргу — а скарги не публікуються (в API немає жодного GET для
    // них, політика приватності каже «a moderator reads … nobody else
    // receives them», скарга може нести контакт, який людина лишила). Нова
    // неправда, якої у версії 1.1 не було, створена самою правкою.
    // Ліцензійне формулювання повернеться тоді, коли зʼявиться те, що ми
    // справді публікуємо від читачів (фото, відгуки).
    body = replaceSpan(
      body,
      'If you send us content',
      'by writing to [{{company.email}}](mailto:{{company.email}}).',
      'If you send us content — at the moment that means one thing, a written report of a mistake in our data, sent through the “Report a problem” form on a campsite page — you keep it. We do not publish it: a person reads it and, if it is right, corrects our own data. If we ever begin to publish what readers send us, such as photographs, this page will say so first, and will say what you give us permission to do. We may decline a report, and you can ask us to remove one you have sent at any time by writing to [{{company.email}}](mailto:{{company.email}}).',
    );
    // 2. Де попередні редакції.
    body = replaceOnce(
      body,
      'and the previous wording is recorded in our public source repository, so it is always possible to establish which version applied on a given day.',
      'and we keep every earlier wording ourselves: write to [{{company.email}}](mailto:{{company.email}}) and we will send you the text that was in force on any day you name.',
    );
    return {
      slug: this.previous.slug,
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.2',
      effectiveFrom: '2026-11-02',
      body,
    };
  })();

  public async up(queryRunner: QueryRunner): Promise<void> {
    await applyLegalUpdate(queryRunner, this.page, this.previous);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await revertLegalUpdate(queryRunner, this.page, this.previous);
  }
}
