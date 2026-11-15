import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Коли звірник OSM↔DATAtourisme востаннє ВІДПРАЦЮВАВ — окремо від того,
 * коли він востаннє щось знайшов.
 *
 * 🔴 `spot_links.created_at` ВІДПОВІДАЄ НЕ НА ТЕ ПИТАННЯ. Звірник пише
 * лише нові пари й ніколи не торкається розсуджених, тож
 * `max(created_at)` — це «коли востаннє зʼявився НОВИЙ звʼязок». Заміряно
 * на проді 13.11.2026: юніт `camptribe-reconcile-sources` 10.11 05:50 UTC
 * завершився успішно з «0 links written», а сторож свіжості бачив вік
 * 9,53 доби при бюджеті 10 — тобто назавтра червонів би на справному
 * збирачі. Той самий клас, що `spot_tariffs.fetched_at` (CAMP-400).
 *
 * 🔴 ЧОМУ ТАБЛИЦЯ, А НЕ КОЛОНКА `checked_at` НА `spot_links`. Колонку
 * довелось би переписувати на всіх ~4 500 рядках щотижня, і вона казала
 * б неправду: розсуджену пару прогін НЕ перевіряє, він її пропускає.
 * Рядок на прогін каже рівно те, що сталось, і заодно лишає історію —
 * скільки записано й скільки відмовила база.
 *
 * 🔴 ЗАСІВ — ОСТАННЯ ВІДОМА ПРАВДА, А НЕ `now()`. Про минулі прогони
 * база знає лише одне: коли зʼявився останній звʼязок. Тож після міграції
 * рядок сторожа читається таким же старим, як був, і зеленіє з першим
 * справжнім прогоном юніта — а не від дати міграції. Порожня `spot_links`
 * (свіжа база, CI) не засіває нічого: «ще не запускався» лишається
 * «ще не запускався».
 *
 * Нічого не видаляється й не змінюється в наявних таблицях.
 */
export class SpotLinkRuns1797200000000 implements MigrationInterface {
  name = 'SpotLinkRuns1797200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE spot_link_runs (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        finished_at timestamptz NOT NULL DEFAULT now(),
        written integer NOT NULL,
        refused integer NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`
      INSERT INTO spot_link_runs (finished_at, written)
      SELECT max(created_at), 0 FROM spot_links
      HAVING max(created_at) IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE spot_link_runs`);
  }
}
