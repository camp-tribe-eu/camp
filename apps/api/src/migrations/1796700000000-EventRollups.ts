import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-504 — запис подій із першого дня: ДВІ таблиці денних лічильників.
 *
 * 🔴 `up()` ЛИШЕ ДОДАЄ. Два `CREATE TABLE IF NOT EXISTS`; жоден наявний
 * рядок, колонка чи обмеження не чіпаються.
 *
 * 🔴 ЦЕ ЛІЧИЛЬНИКИ, А НЕ ЖУРНАЛ. Один рядок на (день, кемпінг, подія, клас
 * джерела) і число `n`; кожна подія — `INSERT … ON CONFLICT DO UPDATE SET
 * n = n + 1`. Сто тисяч переглядів однієї картки за день — один рядок.
 *
 * 🔴 ЧОГО В ТАБЛИЦЯХ НЕМАЄ, і відсутність — це задум: ані IP, ані хеша
 * (дедуплікаційний хеш живе в памʼяті процесу на добу й нікуди не пишеться),
 * ані user-agent, ані реферера (лише КЛАС: organic / ai / direct / other),
 * ані тексту пошуку, ані акаунта. `event-rollups.db.spec.ts` читає список
 * колонок з `information_schema` і валить прогін, якщо зʼявилась будь-яка,
 * чия назва скидається на ip / hash / agent / referrer / query.
 *
 * 🔴 `event`, `source`, `surface` — `text` з `CHECK`, не `enum` (як
 * `problem_reports`): нове значення — видима міграція. Перелік подій тут той
 * самий, що `SPOT_EVENTS` у `events/events.rules.ts` (специфікація звіряє).
 *
 * 🔴 `camping_spot_id` БЕЗ зовнішнього ключа: лічильник про кемпінг, що
 * зник із бази (злиття дублів), лишається історією попиту, а `ON DELETE
 * CASCADE` стер би її разом з кемпінгом.
 *
 * 🔴 НЕ ЗАРЕЄСТРОВАНО В DIRECTUS. Це службові дані; власнику їх редагувати
 * не треба, а реєстрована колекція коштує слот із 25.
 */
export class EventRollups1796700000000 implements MigrationInterface {
  name = 'EventRollups1796700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS spot_event_daily (
        day date NOT NULL,
        camping_spot_id uuid NOT NULL,
        event text NOT NULL,
        source text NOT NULL,
        n integer NOT NULL,
        PRIMARY KEY (day, camping_spot_id, event, source),
        CONSTRAINT spot_event_daily_event CHECK (event IN (
          'spot_view', 'website_click', 'phone_click', 'coords_copy',
          'gpx_download', 'route_inclusion'
        )),
        CONSTRAINT spot_event_daily_source CHECK (source IN (
          'organic', 'ai', 'direct', 'other'
        )),
        CONSTRAINT spot_event_daily_n CHECK (n > 0)
      )
    `);
    // «Скільки разів дивились цю картку» — за кемпінгом, за днями.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_spot_event_daily_spot
        ON spot_event_daily (camping_spot_id, day)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS zero_result_search_daily (
        day date NOT NULL,
        surface text NOT NULL,
        filters text NOT NULL,
        n integer NOT NULL,
        PRIMARY KEY (day, surface, filters),
        CONSTRAINT zero_result_search_daily_surface CHECK (
          surface IN ('search', 'map')
        ),
        CONSTRAINT zero_result_search_daily_filters CHECK (
          char_length(filters) <= 300 AND filters ~ '^[A-Za-z_:,|]*$'
        ),
        CONSTRAINT zero_result_search_daily_n CHECK (n > 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS zero_result_search_daily`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_spot_event_daily_spot`);
    await queryRunner.query(`DROP TABLE IF EXISTS spot_event_daily`);
  }
}
