import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
  seededPage,
} from '../pages/legal-update';

/**
 * Опис бази 1.0 → 1.1: чотири місця, де сторінка описувала інший код.
 * Це опис змін за ODbL §4.6, тож неточність тут — неточність ліцензійного
 * документа, а не стилю.
 *
 * 🔴 ЩО ЗАМІРЯНО (02.11.2026).
 *
 *  6. «the nearest shop that sells food» → у коді лише `shop=supermarket`:
 *     імпорт (`scripts/osm-pipeline/load-context.sh`) фільтрує
 *     `n/shop=supermarket w/shop=supermarket`, запит
 *     (`apps/api/src/osm/context-sql.ts`) — `x.shop = 'supermarket'`.
 *  7. «two campsites in one region» → суфікс слага призначається ГЛОБАЛЬНО:
 *     `usedSlugs` у `import-spots.ts` будується з `SELECT slug FROM
 *     camping_spots` без `WHERE`, а унікальний індекс — на `("slug")`
 *     одному (`InitSchema`).
 *  8. «Each campsite record also carries whether we consider its region
 *     large enough … and whether a price list is withheld» → у
 *     `camping_spots` таких колонок НЕМАЄ (31 колонка, жодна про це;
 *     `psql … information_schema.columns`). Обидва значення рахуються на
 *     запиті: `r.spots >= REGION_INDEX_THRESHOLD` у `spots.service.ts` і
 *     `withheldTariffCountSql` у `spots/tariffs.ts`.
 *  9. «The record that loses is not kept» → теги переможеного
 *     КОПІЮТЬСЯ в переможця (`dedupe` і `mergeUnnamed`), але лише ті, яких
 *     у переможця немає: де тег є в обох, лишається значення переможця.
 *     Для опису змін це суттєво: перша редакція приховувала дію над даними.
 *
 * Текст — чотири заміни з перевіркою єдиності якоря. Тести —
 * `apps/web/tests/unit/legal-database-claims.spec.ts`.
 */
export class DatabaseHonestClaims1793802000000 implements MigrationInterface {
  name = 'DatabaseHonestClaims1793802000000';

  /** Те, що 1.0 поклав у базу посів. */
  readonly previous = seededPage('database');

  readonly page = (() => {
    let body = this.previous.body;
    // 6. Лише супермаркет.
    body = replaceOnce(
      body,
      '- **supermarket** — the nearest shop that sells food, with its distance and name.',
      '- **supermarket** — the nearest supermarket (OpenStreetMap tag shop=supermarket), with its distance and name.',
    );
    // 7. Слаг унікальний на весь набір, не на регіон.
    body = replaceOnce(
      body,
      'Where two campsites in one region would take the same address, the later one is given a numeric suffix.',
      'Where two campsites would take the same address, anywhere in the database, the later one is given a numeric suffix.',
    );
    // 9. Переможений не лишається записом, але його теги так.
    body = replaceOnce(
      body,
      'The record that loses is not kept.',
      'The record that loses is not kept as a record of its own, but what it carried is not thrown away: every tag it had that the surviving record lacked is copied into the survivor, and where both carry the same tag the survivor’s value stands.',
    );
    // 8. Рішення, а не поле запису.
    body = replaceOnce(
      body,
      'Each campsite record also carries whether we consider its region large enough to publish an index page for, and whether a price list we hold is withheld from display.',
      'Two more things are decided by us, and neither is stored in the campsite record. Whether its region is large enough for us to publish an index page for is worked out when the page is built, from how many campsites the region holds at that moment; whether a price we hold is withheld from display is worked out the same way, from whether the source gave it any date.',
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
