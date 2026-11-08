import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-400, пункт 2 / CAMP-147: коли цей тариф востаннє ЗВІРЕНО з фідом.
 *
 * 🔴 `created_at` НЕ РУХАЄТЬСЯ ПРИ `ON CONFLICT DO UPDATE`, а сторож
 * свіжості читав саме її. Заміряно на проді 08.11.2026: у 13 104 рядках
 * рівно дві дати створення — 28.09 (12 402) і 26.10 (702), хоч імпорт
 * 26.10 перечитав увесь фід і оновив кожен збіг. Тобто `max(created_at)`
 * відповідає на «коли востаннє зʼявився НОВИЙ тариф», а не на «коли
 * імпортер востаннє ходив». Тиждень, у якому фід не додав жодного
 * тарифу, читався б як зупинка збирача — і таймер, який ставиться цією
 * ж карткою, не зміг би зробити рядок сторожа зеленим. Сторож міряв би
 * не те, що лагодять.
 *
 * Колонка — за зразком `fuel_station_prices.fetched_at` і
 * `webcams.fetched_at`: імпортер ставить її на кожному рядку, який
 * вставив АБО переказав із фіду (`import-prices.ts`, `insertBatch`).
 *
 * 🔴 ЗАСІВ — `created_at`, А НЕ `now()`. Дата міграції нічого не каже про
 * те, коли рядок справді звіряли; «точно торкались при створенні» —
 * єдине, що про старі рядки відомо напевно. Тож після міграції вони
 * читаються такими ж старими, як були, і перший оберт таймера — це
 * перша справжня свіжість, а не намальована. (На проді це означає: рядок
 * сторожа лишається червоним до першого четверга — і так і має бути.)
 */
export class SpotTariffFetchedAt1794600000000 implements MigrationInterface {
  name = 'SpotTariffFetchedAt1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE spot_tariffs
        ADD COLUMN fetched_at timestamptz NOT NULL DEFAULT now()
    `);
    await queryRunner.query(`UPDATE spot_tariffs SET fetched_at = created_at`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE spot_tariffs DROP COLUMN fetched_at`);
  }
}
