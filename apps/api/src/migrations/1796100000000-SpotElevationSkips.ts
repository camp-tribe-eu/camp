import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-493: карантин для кемпінга, якому заповнювач не зміг порахувати висоту.
 *
 * 🔴 МІТКА ЖИВЕ ТУТ, А НЕ В `camping_spots.context`. Перша редакція
 * дописувала `elevation_skipped` у `context`, а правило індексації
 * (`NOTHING_TO_SAY_SQL` у `spots/detail-query.ts`) — буквально
 * `context = '{}'`. Замір рецензента: рядок без жодного факту мав
 * `indexable=false`, після карантину став `indexable=true` — тобто кемпінг,
 * якому не вдалось порахувати висоту, потрапляв би в індекс і sitemap, не
 * маючи що сказати читачеві. Чужу підсистему збоку не міняємо: окрема
 * таблиця лишає `context` недоторканим.
 *
 * 🔴 `until` ЧИТАЄ ЛИШЕ ЗАПОВНЮВАЧ. Сторож рахує «у карантині» за самим
 * наявним рядком, без порівняння з часом: інакше строк, що спливає між
 * заповнювачем (05:15) і сторожем (06:15), давав би хибне червоне раз на
 * 30 діб і звинувачував заповнювача, який нічого не пропустив. Заповнювач
 * сам пробує рядок знову, коли `until` минув, і або заповнює його, або
 * подовжує строк тут же.
 *
 * Міграція лише ДОДАЄ таблицю: жодних даних не видаляє. Таблиця не
 * зареєстрована в Directus, тож слота з 25 не коштує.
 */
export class SpotElevationSkips1796100000000 implements MigrationInterface {
  name = 'SpotElevationSkips1796100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "spot_elevation_skips" (
        "camping_spot_id" uuid NOT NULL,
        "until" TIMESTAMP WITH TIME ZONE NOT NULL,
        "why" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_spot_elevation_skips" PRIMARY KEY ("camping_spot_id"),
        CONSTRAINT "FK_spot_elevation_skips_spot"
          FOREIGN KEY ("camping_spot_id") REFERENCES "camping_spots"("id")
          ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "spot_elevation_skips"`);
  }
}
