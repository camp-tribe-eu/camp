import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
  seededPage,
} from '../pages/legal-update';

/**
 * Правова примітка 1.0 → 1.1: розділ «The other pages» називав чотири
 * сторінки, а інших правових сторінок шість (реєстр `lib/legal.ts`: сім,
 * мінус сама примітка). Додано `disclaimer` і `database` — назвами з
 * реєстру, як і решту чотирьох, у порядку реєстру.
 *
 * 🔴 Звіряє перелік із реєстром у обидва боки
 * `apps/web/tests/unit/legal-notice-pages.spec.ts`: нова сторінка в
 * реєстрі без рядка тут і рядок тут без сторінки в реєстрі червоніють
 * однаково.
 */
export class NoticeAllPages1793803000000 implements MigrationInterface {
  name = 'NoticeAllPages1793803000000';

  /** Те, що 1.0 поклав у базу посів. */
  readonly previous = seededPage('notice');

  readonly page = (() => {
    const body = replaceOnce(
      this.previous.body,
      '[Terms of use](/legal/terms) · [Privacy](/legal/privacy) · [Cookies](/legal/cookies) · [Data and attribution](/legal/attribution)',
      '[Terms of use](/legal/terms) · [Privacy](/legal/privacy) · [Cookies](/legal/cookies) · [What we do and do not know](/legal/disclaimer) · [Data and attribution](/legal/attribution) · [How this database is made](/legal/database)',
    );
    return {
      slug: this.previous.slug,
      title: this.previous.title,
      summary: this.previous.summary,
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
