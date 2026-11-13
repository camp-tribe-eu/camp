import { MigrationInterface, QueryRunner } from 'typeorm';
import { ThemeChoiceCookies1795100000000 } from './1795100000000-ThemeChoiceCookies';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Кукі 1.2 → 1.3: ПʼЯТИЙ запис у сховищі браузера — вибір «маю кемпер /
 * орендую» (CAMP-501). Причини й аргумент про згоду — у
 * `1797100100000-PrivacyPersonaChoice.ts`; тут той самий запис описаний
 * мовою сторінки про кукі.
 */
export class PersonaChoiceCookies1797100200000 implements MigrationInterface {
  name = 'PersonaChoiceCookies1797100200000';

  readonly previous = new ThemeChoiceCookies1795100000000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      'Our own code writes four entries into your browser’s storage, and nothing else.',
      'Our own code writes five entries into your browser’s storage, and nothing else.',
    );
    body = replaceOnce(
      body,
      '**That is the complete list.**',
      `**Who you are here** — camptribe.persona, in local storage. The two buttons in the header, “I have a camper” and “I am renting one”, decide which part of a page comes first; your choice is kept so that the next page you open does the same. It holds one word, “owner” or “renter”, is never sent to us, and identifies nobody. Until you press a button there is no entry at all; pressing the same button again removes it. We store it because you asked for it by pressing the button, and the service you asked for cannot be delivered without remembering the answer, so it does not need consent either.

**That is the complete list.**`,
    );
    return {
      slug: this.previous.slug,
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.3',
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
