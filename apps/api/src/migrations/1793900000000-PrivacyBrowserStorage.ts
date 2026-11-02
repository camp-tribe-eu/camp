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
 *  3. «Your account» і «short version» обіцяли «what you save — trips,
 *     places, photos, reviews», а «What deletion does not reach» —
 *     відхилене фото чи відгук. Сайт цього не приймає: write-маршрутів
 *     save/review/photo/upload у контролерах нуль, `trips.controller.ts` має
 *     лише GET. Перелік «we hold … and nothing else» тепер називає те, що
 *     справді є (пошта, хеш пароля, запис згоди на листи, сесії), а про фото
 *     й відгуки сказано «does not yet» — із тим, що правило видалення вже
 *     є в коді (`account-rights.service.ts`) і діятиме, коли вони зʼявляться.
 *
 *  4. «Changes»: «so their full text is in our public source repository» →
 *     «so they are recorded in our public source repository» (див. коментар
 *     біля заміни) і «we will tell you which text» → «we will send you the
 *     text», як у terms §6.
 *
 * 🔴 ТЕКСТ — ВІСІМ ЗАМІН З ПЕРЕВІРКОЮ ЄДИНОСТІ ЯКОРЯ, від тіла 2.3, яке бере
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
    // 🔴 Пункти про «what you save»: політика досі обіцяла фото, відгуки,
    // поїздки й збережені місця, яких сайт не приймає (рецензія #399/#401:
    // write-маршрутів save/review/photo/upload у контролерах нуль, у
    // `trips.controller.ts` лише GET, експорт сам пише «there is no photo
    // upload yet»). «We hold the following, and nothing else» із переліком
    // того, чого ми не тримаємо, — найгірша неправда в політиці
    // приватності: саме це речення читають, щоб зрозуміти обсяг.
    body = replaceOnce(
      body,
      'and whatever you save — trips, places, photos.',
      'and which browsers are signed in — nothing else, because the site does not yet let you save anything.',
    );
    body = replaceOnce(
      body,
      'An account exists so that what you save stays yours across devices. We hold the following, and nothing else:',
      'An account is how the site knows who you are when you sign in. We hold the following, and nothing else:',
    );
    body = replaceOnce(
      body,
      '- sessions — the fact that a browser is signed in, and until when;\n- what you saved: trips and their stops, saved places, photos you submitted, reviews you wrote.',
      '- sessions — the fact that a browser is signed in, and until when.\n\nThe site does not yet let you save a trip, a place, a photograph or a review, so there is nothing of that kind to hold. When it does, this list changes with it, in the same release; the data file and the account deletion described below already cover them.',
    );
    body = replaceSpan(
      body,
      '> **What deletion does not reach, and why.**',
      'We would rather tell you where the line is than let you discover it.',
      '> **What deletion does not reach, and why.** The site does not yet take photographs or reviews, so today there is nothing of that kind to keep. The rule is already part of account deletion, and it is this: one record would survive — that a photo or a review was rejected, why, when, and for which place. It would carry nothing that points back to you — no name, no address, not even a reference to the account that was deleted. Because no part of it identifies a person, it would have stopped being personal data, and the right to erasure would have nothing left to reach. We would keep it to be able to account for our own moderation decisions. Separately, the licence you grant for photographs once they are published is a contract rather than personal data, so those photographs may remain — but your name comes off them on request. We would rather tell you where the line is than let you discover it.',
    );
    // 🔴 «What we do not do»: «What you save is shown back to you; it is not
    // used to score or categorise you» — те саме «what you save», п'яте місце:
    // розділ нижче каже «the site does not yet let you save anything», а цей
    // розділ читач відкриває саме тоді, коли хоче знати, чого з його даними НЕ
    // роблять. Сторож ловить це за дієсловом `save` у всіх формах, а не за
    // переліком іменників (`legal-privacy-holds.spec.ts`).
    body = replaceOnce(
      body,
      'What you save is shown back to you; it is not used to score or categorise you.',
      'Nothing we hold about you is used to score or categorise you.',
    );
    // 🔴 «Changes»: «so their full text is in our public source repository»
    // стверджувало, що повний текст попередньої редакції можна ПРОЧИТАТИ в
    // репозиторії. Для п'яти редакцій з PR #399/#401 (terms 1.2, cookies 1.1,
    // database 1.1, notice 1.1, privacy 2.4) це неправда: їхні міграції
    // складають текст замінами з попереднього (не передруковують його двічі —
    // і це правильно), тож у файлі його не прочитати, лише відтворити
    // виконанням. Речення описує механізм, який є: редакції приїздили кодом і
    // записані в репозиторії. Те саме, тими самими словами, — у terms §6
    // (`legal-edition-storage.spec.ts` червоніє, коли сторінки розходяться).
    body = replaceOnce(
      body,
      'each shipped as code, so their full text is in our public source repository;',
      'each shipped as code, so they are recorded in our public source repository;',
    );
    body = replaceOnce(
      body,
      'Write to us and we will tell you which text was in force on a given day.',
      'Write to us and we will send you the text that was in force on any day you name.',
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
