import { MigrationInterface, QueryRunner } from 'typeorm';
import { PrivacySpotClaims1794400000000 } from './1794400000000-PrivacySpotClaims';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Приватність 2.5 → 2.6: у сховищі браузера зʼявився
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
export class ThemeChoicePrivacy1795200000000 implements MigrationInterface {
  name = 'ThemeChoicePrivacy1795200000000';

  /** Те, що 2.5 поклала в базу — береться з її міграції. */
  readonly previous = new PrivacySpotClaims1794400000000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      'Our own code writes three entries into your browser’s storage, and nothing else.',
      'Our own code writes four entries into your browser’s storage, and nothing else.',
    );
    body = replaceOnce(
      body,
      '- **Where to send you back** — camptribe.return, in session storage:',
      `- **How the site looks to you** — camptribe.theme, in local storage: light or dark, as you chose with the button in the header, so that the next page looks the same. Until you press it there is no entry and we follow your device’s setting; returning to that setting removes the entry. It holds one word, is never sent to us, and identifies nobody.
- **Where to send you back** — camptribe.return, in session storage:`,
    );
    return {
      // Літерал, а не `this.previous.slug`: сторож реєстру шукає останню
      // міграцію політики за `slug: 'privacy'` у тексті файла.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '2.6',
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
