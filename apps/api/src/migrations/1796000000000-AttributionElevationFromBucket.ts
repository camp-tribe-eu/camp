import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';
import { AttributionFlags1794800000000 } from './1794800000000-AttributionFlags';

/**
 * Сторінка «Data and attribution» 1.2 → 1.3: висота приходить із відра,
 * а не через API — CAMP-484.
 *
 * 🔴 ЦЕ ВИПРАВЛЕННЯ НЕПРАВДИ НА ПРАВОВІЙ СТОРІНЦІ, А НЕ РЕДАКТУРА.
 *
 * Текст казав читачеві, що висота «reached through Open-Meteo's
 * elevation endpoint at api.open-meteo.com». Після CAMP-484 це більше
 * не так: виклик із коду прибрано, а дані читаються з відкритого відра
 * `openmeteo` на AWS Open Data — ті самі Copernicus GLO-90, та сама
 * ліцензія CC-BY-4.0, інший шлях.
 *
 * Сторінка атрибуції — це твердження про походження даних. Лишити в ній
 * шлях, яким ми більше не ходимо, означає розповідати про себе неправду
 * саме там, де ми обіцяємо точність.
 *
 * 🔴 ЧОМУ ЗГАДКА ПРО OPEN-METEO ЛИШАЄТЬСЯ. Відро їхнє, і CC-BY-4.0
 * вимагає назвати автора. Змінився шлях, а не джерело: прибрати їх
 * звідси було б другою неправдою замість першої.
 *
 * 🔴 ЧОМУ ТУТ НЕМАЄ ЗГАДКИ ПРО ЗМІНУ ЛІЦЕНЗІЇ. Її не було: і endpoint,
 * і відро дають дані під CC-BY-4.0. Лист Open-Meteo (Ticket#235498,
 * 10.11.2026) підтвердив лише те, що відро придатне й для комерційного
 * вжитку, — тобто зняв НАШЕ обмеження, а не змінив їхнє.
 */
export class AttributionElevationFromBucket1796000000000 implements MigrationInterface {
  name = 'AttributionElevationFromBucket1796000000000';

  /** Те, що 1.2 поклала в базу — береться з її міграції, не передруковується. */
  readonly previous = new AttributionFlags1794800000000().page;

  readonly page = (() => {
    const body = replaceOnce(
      this.previous.body,
      'Height above sea level and the relief figure come from the [Copernicus DEM](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model) at 90 m resolution, reached through [Open-Meteo](https://open-meteo.com/)’s elevation endpoint at [api.open-meteo.com](https://api.open-meteo.com/), whose data Open-Meteo provides under CC BY 4.0. Produced using modified Copernicus data.',
      'Height above sea level and the relief figure come from the [Copernicus DEM](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model) at 90 m resolution, as published by [Open-Meteo](https://open-meteo.com/) in its open data bucket on [AWS Open Data](https://registry.opendata.aws/open-meteo/) under CC BY 4.0. We read the elevation tiles there and compute both figures ourselves; the relief is the highest minus the lowest elevation across eight points on a one-kilometre circle plus the centre. Produced using modified Copernicus data.',
    );
    return {
      // Літерал, а не `this.previous.slug`: сторож реєстру шукає останню
      // міграцію документа за `slug: '…'` у тексті файла.
      slug: 'attribution',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.3',
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
