import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  applyLegalUpdate,
  replaceOnce,
  replaceSpan,
  revertLegalUpdate,
  seededPage,
} from '../pages/legal-update';

/**
 * Кукі 1.0 → 1.1: «це єдине, що ми зберігаємо» — а ключів три; і мапа
 * «називає провайдера й дає перемкнути» не скрізь.
 *
 * 🔴 ЩО ЗАМІРЯНО (02.11.2026, з назвою знаменника).
 *
 *  · Ключів, які код пише в сховище браузера: ТРИ — `camptribe.consent`
 *    (`localStorage`, `lib/consent.ts`), `camptribe.session`
 *    (`localStorage`, `lib/session-store.ts`) і `camptribe.return`
 *    (`sessionStorage`, `lib/return-path.ts`). Це всі `.setItem(` у
 *    `apps/web/src`.
 *  · Кукі, які код ставить (`document.cookie =`, `cookies()`, `Set-Cookie`,
 *    `res.cookie`) у `apps/web/src` і `apps/api/src`: НУЛЬ. Тож сторінка
 *    називає їх «web storage, а не кукі» й обмежує «не ставимо» словами
 *    «наш код»: що додає Cloudflare перед сервером, із репозиторію не
 *    видно (сервера в ньому немає).
 *  · Перемикач стилів мапи («Map style») рендерить `campsite-map.tsx`, а
 *    його підключає лише `/map`. Мапа на сторінці кемпінгу (`site-map.tsx`)
 *    і мапа маршруту (`route-map.tsx`) кнопок не мають. Усі три мапи
 *    називають провайдера: у кредиті на мапі й рядком під нею (на сторінці
 *    кемпінгу контроль кредиту ввімкнено тією ж гілкою — раніше його
 *    не було).
 *
 * 🔴 ДВА ПОБІЧНІ ВИПРАВЛЕННЯ, БЕЗ ЯКИХ СТОРІНКА СУПЕРЕЧИЛА Б САМІЙ СОБІ:
 * заголовок «Nothing is stored on your device until you choose» став
 * «Nothing optional …» (сесія й адреса повернення пишуться за дією читача,
 * а не за відповіддю на банер), і рядок-підсумок у реєстрі — теж. Обидва
 * видно в описі PR як окремий пункт: їх легко відкинути.
 *
 * 🔴 Версія кукі підіймає зміну, яку читач не бачить: `consent.ts` ключує
 * збережену згоду версією цієї сторінки, тож банер спитає ще раз. Сайт
 * закритий, читачів нуль.
 *
 * Текст — три заміни з перевіркою єдиності якоря; тести —
 * `apps/web/tests/unit/legal-cookies-claims.spec.ts`.
 */
export class CookiesHonestClaims1793801000000 implements MigrationInterface {
  name = 'CookiesHonestClaims1793801000000';

  /** Те, що 1.0 поклав у базу посів. */
  readonly previous = seededPage('cookies');

  readonly page = (() => {
    let body = this.previous.body;
    body = replaceOnce(
      body,
      '> **Nothing is stored on your device until you choose.**',
      '> **Nothing optional is stored on your device until you choose.**',
    );
    // 4. Усі три ключі — чесно, з призначенням кожного.
    body = replaceSpan(
      body,
      '## What we store {#what}',
      'and the banner will ask before anything is set.',
      `## What we store {#what}

Our own code writes three entries into your browser’s storage, and nothing else. They are web storage, not cookies: the code of this site sets no cookies. Each entry has one job, and each is named here so that you can find it in your browser’s developer tools.

**Your choice itself** — camptribe.consent, in local storage. When you answer the banner we keep what you chose, when, and which version of this policy was in force. It stays on your device, is never sent to us, and identifies nobody.

It is stored whether you accept or reject — otherwise we would have to ask you the same question on every page, and a site that keeps asking until it gets a yes is not asking. Because it is strictly necessary to honour your decision, it does not itself need consent.

**Your sign-in** — camptribe.session, in local storage. It exists only if you sign in or create an account, and it is what keeps you signed in on this browser: a token our server gave you, when that token expires, and the email address of the account. It is sent to our server only as proof of who you are when you use your account pages, and it is removed when you sign out or when it has expired. We store it because you asked to sign in, whatever you chose at the banner, and it is strictly necessary for that, so it does not need consent either.

**Where to send you back** — camptribe.return, in session storage. If you open your account page without being signed in, we send you to the sign-in page and note the address you came from, so that you land back there afterwards. It lives only in that browser tab, is deleted the moment it is used, is ignored after fifteen minutes, and goes when you close the tab. It is strictly necessary for the same reason.

**That is the complete list.** This site sets no analytics cookies, no advertising cookies and no third-party cookies today. If that changes, this page changes with it, in the same release, and the banner will ask before anything optional is set.`,
    );
    // 5. Мапа: хто називає провайдера, і де справді є перемикач.
    body = replaceSpan(
      body,
      'The map fetches its background imagery from an external tile provider.',
      'and lets you switch.',
      `Every map on this site — on the [map page](/map), on each campsite page and on each route page — fetches its background imagery from an external tile provider, OpenFreeMap. That is a direct connection from your browser to them, the same as loading any image, and it sets no cookies through us. It is not something we can consent to on your behalf, which is why each map names its provider: in the credit on the map itself and in a line beneath it.

Only the [map page](/map) has buttons for changing how the map looks. They switch between three styles, all served by that same provider, so they change the look and not who sees your request. The satellite view beside them is off until you switch it on, and it comes from a national mapping agency instead — the [privacy](/legal/privacy#map) policy says which. The maps on campsite and route pages have no such buttons.`,
    );
    return {
      slug: this.previous.slug,
      title: this.previous.title,
      summary:
        'Nothing optional is stored on your device until you say yes, and saying no is one click.',
      version: '1.1',
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
