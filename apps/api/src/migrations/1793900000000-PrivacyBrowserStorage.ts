import { MigrationInterface, QueryRunner } from 'typeorm';
import { PrivacyRetentionLogs1793600000000 } from './1793600000000-PrivacyRetentionLogs';
import {
  applyLegalUpdate,
  replaceOnce,
  replaceSpan,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Політика приватності 2.3 → 2.4: два місця, де вона описувала сховище
 * браузера й підтвердження віку інакше, ніж це робить код — і інакше, ніж
 * сторінки «Cookies» 1.1 та «Terms» 1.2.
 *
 * 🔴 ТА САМА ЗНАХІДКА, ЩО В `CookiesHonestClaims` І `TermsHonestClaims`, У
 * МІСЦЯХ, ЯКИХ ТІ МІГРАЦІЇ НЕ ЧІПАЛИ (privacy мала власну картку).
 *
 *  1. «Your cookie choice»: «we store that answer — and only that answer —
 *     on your own device». Код пише в браузер ТРИ ключі: `camptribe.consent`,
 *     `camptribe.session` (токен після входу) і `camptribe.return` (адреса
 *     повернення), і два останні зʼявляються за дією читача, а не за
 *     відповіддю на банер. Розділ переписано ТИМИ САМИМИ словами, що й
 *     «What we store» у cookies 1.1: однакове вступне речення, ті самі три
 *     ключі, те саме сховище, той самий строк. Читач, який звірить дві
 *     сторінки, має побачити згоду, а не розбіжність.
 *  2. «Children»: «we ask you to confirm that». Запиту немає: галочки віку
 *     нема, є твердження в реченні над кнопкою реєстрації. Слова — ті, що в
 *     terms 1.2 («Creating an account is your confirmation that you are
 *     eighteen or older … there is no box to tick»).
 *
 * 🔴 ТЕКСТ — ДВІ ЗАМІНИ З ПЕРЕВІРКОЮ ЄДИНОСТІ ЯКОРЯ, від тіла 2.3, яке бере
 * з його міграції, а не передруковує. Версію піднімає й реєстр
 * `lib/legal.ts`. Збіг трьох поверхонь (cookies, privacy, банер) тримає
 * `apps/web/tests/unit/legal-storage-surfaces.spec.tsx`: ключі виводяться з
 * коду, а не переписуються в трьох місцях руками.
 */
export class PrivacyBrowserStorage1793900000000 implements MigrationInterface {
  name = 'PrivacyBrowserStorage1793900000000';

  /** Те, що 2.3 поклала в базу — береться з її міграції, не передруковується. */
  readonly previous = new PrivacyRetentionLogs1793600000000().page;

  readonly page = (() => {
    let body = this.previous.body;
    body = replaceSpan(
      body,
      '### Your cookie choice',
      'The details are on the [cookies](/legal/cookies) page.',
      `### What we keep in your browser

Our own code writes three entries into your browser’s storage, and nothing else. They are web storage, not cookies: the code of this site sets no cookies. Each entry has one job:

- **Your choice itself** — camptribe.consent, in local storage: your answer to the cookie banner. It stays on your device, is never sent to us, and identifies nobody.
- **Your sign-in** — camptribe.session, in local storage, only if you sign in or create an account: a token our server gave you, when that token expires, and the email address of the account. It is sent to our server only as proof of who you are when you use your account pages, and it is removed when you sign out or when it has expired.
- **Where to send you back** — camptribe.return, in session storage: if you open your account page without being signed in, the address you came from, so that you land back there after signing in. It lives only in that browser tab, is deleted the moment it is used, is ignored after fifteen minutes, and goes when you close the tab.

The details are on the [cookies](/legal/cookies) page.`,
    );
    body = replaceOnce(
      body,
      'Opening one requires you to be eighteen, and we ask you to confirm that rather than asking for your date of birth — a date we would then be holding and would have to protect, to answer a question that a yes already answers.',
      'Opening one requires you to be eighteen. Creating an account is your confirmation that you are eighteen or older: the sign-up form says so in a sentence above the button, and there is no box to tick. We do not ask for your date of birth — a date we would then be holding and would have to protect, to answer a question that the confirmation already answers.',
    );
    return {
      // Літерал, а не `this.previous.slug`: сторож реєстру (`problem-reports-policy`,
      // PR #397) шукає останню міграцію політики за `slug: 'privacy'` у тексті файла.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '2.4',
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
