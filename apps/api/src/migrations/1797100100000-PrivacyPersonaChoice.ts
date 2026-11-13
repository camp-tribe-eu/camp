import { MigrationInterface, QueryRunner } from 'typeorm';
import { PrivacyEventCounts1796800000000 } from './1796800000000-PrivacyEventCounts';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Приватність 2.7 → 2.8: у сховищі браузера зʼявився ПʼЯТИЙ запис —
 * вибір «маю кемпер / орендую» (CAMP-501).
 *
 * 🔴 ЦЕ НЕ ОФОРМЛЕННЯ, А ОБОВʼЯЗОК: обидві сторінки стверджують перелік
 * поіменно й числом («four entries … and nothing else»). Сторож
 * `legal-storage-surfaces.spec.tsx` читає кожен `.setItem(` під
 * `apps/web/src` і звіряє перелік зі сторінками.
 *
 * 🔴 ЗГОДИ ЗАПИС НЕ ПОТРЕБУЄ — той самий аргумент, що для `camptribe.theme`:
 * читач сам натиснув кнопку, послуга («покажи мені спершу те, що мені
 * потрібно») запитана прямо й без запамʼятовування не виконується:
 * наступна сторінка знову була б у типовому порядку. Запису немає, доки
 * читач не натиснув; повторне натискання на ту саму кнопку ключ видаляє.
 */
export class PrivacyPersonaChoice1797100100000 implements MigrationInterface {
  name = 'PrivacyPersonaChoice1797100100000';

  readonly previous = new PrivacyEventCounts1796800000000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      'Our own code writes four entries into your browser’s storage, and nothing else.',
      'Our own code writes five entries into your browser’s storage, and nothing else.',
    );
    body = replaceOnce(
      body,
      '- **Where to send you back** — camptribe.return, in session storage:',
      `- **Who you are here** — camptribe.persona, in local storage: “owner” or “renter”, as you chose with the two buttons in the header (I have a camper / I am renting one), so that the next page puts first what that choice asks for. Until you press a button there is no entry; pressing the same button again removes it. It holds one word, is never sent to us, and identifies nobody.
- **Where to send you back** — camptribe.return, in session storage:`,
    );
    return {
      // Літерал: сторож реєстру шукає останню міграцію політики за `slug: 'privacy'`.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '2.8',
      effectiveFrom: '2026-11-12',
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
