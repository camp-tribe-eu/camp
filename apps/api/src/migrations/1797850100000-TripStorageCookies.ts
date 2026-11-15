import { MigrationInterface, QueryRunner } from 'typeorm';
import { PersonaChoiceCookies1797100200000 } from './1797100200000-PersonaChoiceCookies';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Кукі 1.3 → 1.4: ШОСТИЙ запис у сховищі браузера — збережені поїздки
 * планувальника (CAMP-456). Причини й аргумент про згоду — у
 * `1797850000000-PrivacyTripStorage.ts`; тут той самий запис описаний мовою
 * сторінки про кукі.
 */
export class TripStorageCookies1797850100000 implements MigrationInterface {
  name = 'TripStorageCookies1797850100000';

  readonly previous = new PersonaChoiceCookies1797100200000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      'Our own code writes five entries into your browser’s storage, and nothing else.',
      'Our own code writes six entries into your browser’s storage, and nothing else.',
    );
    body = replaceOnce(
      body,
      '**That is the complete list.**',
      `**Your saved trips** — camptribe.trips, in local storage. The trip planner has a “Save this trip” button; what you save — the places you entered, the number of days and, if you gave them, your vehicle’s type and size, up to ten trips under names you chose — is kept in your browser so that the trip is still there when you come back. It is never sent to us and holds no name or identifier of you. Until you press the button there is no entry at all; deleting the last saved trip removes it. We store it because you asked for it by pressing the button, and the service you asked for cannot be delivered without remembering it, so it does not need consent either.

**That is the complete list.**`,
    );
    return {
      slug: this.previous.slug,
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.4',
      effectiveFrom: '2026-11-15',
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
