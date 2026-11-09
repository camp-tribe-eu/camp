import { MigrationInterface, QueryRunner } from 'typeorm';
import { DatabaseHonestClaims1793802000000 } from './1793802000000-DatabaseHonestClaims';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Опис бази 1.1 → 1.2: сторінка описувала правило, якого код більше не
 * виконує.
 *
 * 🔴 ЦЕ НЕ СТИЛЬ, А ЛІЦЕНЗІЙНИЙ ДОКУМЕНТ (ODbL §4.6). Редакція 1.1
 * стверджувала: «whether a price we hold is withheld from display is
 * worked out … from whether the source gave it any date». З CAMP-475 це
 * неправда в обидва боки — недатовану ціну ми показуємо, а ховаємо
 * ЗОВСІМ ІНШЕ: рядок, якого джерело більше не публікує.
 *
 * 🔴 ЧОМУ ПРАВИЛО ЗМІНИЛОСЬ. Рішення власника 09.11.2026, дослівно:
 * «показуй ціни де є, дата може бути показана чи відсутня тут, але
 * треба поставити … ми отримуємо данні із офіційних мереж але фінальна
 * ціна може відрізнятись, просимо уточнити у провайдера». Замір, що
 * зробив старе правило надто дорогим: з 13 560 рядків 5 757 без дати
 * (42%), і лише 884 французькі кемпінги з 23 911 показували ціну
 * взагалі (3,7%).
 *
 * 🔴 ЩО САМЕ ТЕПЕР СТВЕРДЖУЄ СТОРІНКА — і де кожне твердження
 * доводиться кодом (сторож `legal-database-claims.spec.ts`):
 *
 *  · «21 days»           → `TARIFF_STALE_AFTER_DAYS` у `spots/tariffs.ts`;
 *  · «dropped rather than shown» → `DISPLAYABLE_TARIFF_SQL`, у якому
 *    лишилась ОДНА умова — свіжість, і жодної про дату;
 *  · «Season not stated» → `NO_SEASON_LABEL` у `web/src/lib/tariffs.ts`;
 *  · нота біля кожної ціни → `data-testid="tariffs-price-note"` у
 *    `tariff-table.tsx`.
 *
 * Текст — одна заміна з перевіркою єдиності якоря, від тіла 1.1, яке
 * береться з його ж міграції, а не передруковується.
 */
export class DatabaseUndatedPrices1794900000000 implements MigrationInterface {
  name = 'DatabaseUndatedPrices1794900000000';

  /** Те, що 1.1 поклала в базу — береться з її міграції. */
  readonly previous = new DatabaseHonestClaims1793802000000().page;

  readonly page = (() => {
    const body = replaceOnce(
      this.previous.body,
      'whether a price we hold is withheld from display is worked out the same way, from whether the source gave it any date.',
      'whether a price we hold is shown at all is worked out the same way, from how recently the source last republished it. A price that is more than 21 days behind the most recent prices in the same feed is dropped rather than shown as current — the source has stopped publishing it, and we have no way to know what replaced it. A price the source published without a season is shown, with its period given as “Season not stated”, and every price on a campsite page carries a note saying that the figure comes from the campsite’s own listing in an official tourism network, that the final price is the campsite’s to set, and that we are not the seller.',
    );
    return {
      slug: this.previous.slug,
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.2',
      effectiveFrom: '2026-11-09',
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
