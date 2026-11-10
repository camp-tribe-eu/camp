import { MigrationInterface, QueryRunner } from 'typeorm';
import { CookiesHonestClaims1793801000000 } from './1793801000000-CookiesHonestClaims';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Кукі 1.1 → 1.2: у сховищі браузера зʼявився
 * четвертий запис — вибір теми (CAMP-448).
 *
 * 🔴 ЦЕ НЕ ОФОРМЛЕННЯ, А ОБОВʼЯЗОК. Обидві сторінки стверджують перелік
 * ПОІМЕННО й числом: «Our own code writes three entries into your
 * browser’s storage, and nothing else». Щойно код починає писати
 * четвертий ключ, це речення стає неправдою — на сторінці, яка існує
 * саме для того, щоб бути правдою.
 *
 * Сторож це й упіймав, а не я: `legal-storage-surfaces.spec.tsx` читає
 * КОЖЕН `.setItem(` під `apps/web/src` і звіряє перелік із обома
 * сторінками. Перша редакція перемикача писала ключ `ct-theme`, якого не
 * називала жодна сторінка, і шість тестів почервоніли одразу.
 *
 * 🔴 ЗГОДИ ЦЕЙ ЗАПИС НЕ ПОТРЕБУЄ, і сторінка каже чому. ePrivacy вимагає
 * згоди на доступ до пристрою, окрім випадку, коли зберігання «strictly
 * necessary for the provision of a service explicitly requested by the
 * subscriber». Читач натиснув кнопку «темна тема» — послуга запитана
 * прямо, і виконати її без запамʼятовування неможливо: наступна сторінка
 * знову була б світлою. Той самий аргумент, що вже стоїть під
 * `camptribe.consent`.
 *
 * 🔴 І ОКРЕМО: ЗАПИСУ НЕМАЄ, ДОКИ ЧИТАЧ НЕ НАТИСНУВ. Доки вибору не
 * зроблено, ключа в сховищі нема зовсім, а сайт іде за налаштуванням
 * системи. Повернення до «за системою» ключ ВИДАЛЯЄ. Це сказано обома
 * сторінками, бо інакше «we store» читалось би як «завжди».
 */
export class ThemeChoiceCookies1795100000000 implements MigrationInterface {
  name = 'ThemeChoiceCookies1795100000000';

  /** Те, що 1.1 поклала в базу — береться з її міграції. */
  readonly previous = new CookiesHonestClaims1793801000000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      'Our own code writes three entries into your browser’s storage, and nothing else.',
      'Our own code writes four entries into your browser’s storage, and nothing else.',
    );
    body = replaceOnce(
      body,
      '**That is the complete list.**',
      `**How the site looks to you** — camptribe.theme, in local storage. The button in the header switches between light and dark; your choice is kept so that the next page you open looks the same. It holds one word, “light” or “dark”, is never sent to us, and identifies nobody. Until you press that button there is no entry at all and the site follows your device’s own setting; pressing it a third time removes the entry and returns you to that setting. We store it because you asked for it by pressing the button, and the service you asked for cannot be delivered without remembering the answer, so it does not need consent either.

**That is the complete list.**`,
    );
    return {
      slug: this.previous.slug,
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.2',
      effectiveFrom: '2026-11-10',
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
