import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
  seededPage,
} from '../pages/legal-update';

/**
 * /legal/disclaimer 1.0 → 1.1 (CAMP-489, ревʼю власника CAMP-442, п. 7, 10, 11).
 *
 * Власник просив сказати три речі там, де ми показуємо чужі дані як підказку
 * до рішення в дорозі: (1) дані — інформаційні, від провайдерів даних, можуть
 * відрізнятися від дійсності, користувач застосовує їх на власний розсуд і
 * ризик; (2) ціни й платні дороги можуть бути некоректними чи застарілими;
 * (3) «ми не навігаційна програма, ми провайдер».
 *
 * Абзац «Information, not navigation» дослівно той самий, що показують
 * /plan і калькулятор вартості (`PROVIDER_NOTICE` у apps/web/src/lib/legal.ts);
 * e2e звіряє обидва місця зі сторінкою.
 *
 * 🔴 І ДВІ НЕПРАВДИ, ЗНАЙДЕНІ ПРИ ЧИТАННІ 1.0:
 *  - «We do not know the height, weight or length of your vehicle» — з
 *    CAMP-456 планувальник їх ПИТАЄ й зберігає з поїздкою; правда в тому,
 *    що він не перевіряє ними дороги;
 *  - «open data that volunteers maintain» — ціни на пальне публікує
 *    Єврокомісія, частину кемпінгів — державний DATAtourisme.
 */
const P_EN =
  'CampTribe is an information service, not a navigation system. Distances, prices, tolls, opening seasons and vehicle rules come from third-party data providers and may be incomplete, out of date or different on the ground. You use them at your own discretion and risk.';

export class DisclaimerProviderNotNavigator1798030000000 implements MigrationInterface {
  name = 'DisclaimerProviderNotNavigator1798030000000';

  readonly previous = seededPage('disclaimer');

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      'Everything here is derived from open data that volunteers maintain.',
      'Everything here is derived from open data, maintained by volunteers and published by public bodies.',
    );
    body = replaceOnce(
      body,
      '## Routes and planning {#routes}\n\nWhere we show a route or a distance, it is informational. We do not know the height, weight or length of your vehicle, and we do not check whether a road can carry it.',
      `## Information, not navigation {#information}\n\n> **${P_EN}**\n\nPrices and tolls change most often. A fuel price, a toll tariff or a campsite fee shown here is the figure our source published, and it may have changed since; confirm it with the operator before you count on it.\n\n## Routes and planning {#routes}\n\nWhere we show a route or a distance, it is informational. The trip planner asks for your vehicle’s height, length and weight and saves them with your trip, but it does not use them to check whether a road can carry it.`,
    );
    return {
      slug: 'disclaimer',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.1',
      effectiveFrom: '2026-11-19',
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
