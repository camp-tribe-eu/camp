import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-287 крок 1: де кожен кемпінг лежить, мовою тих, хто попереджає.
 *
 * 🔴 КОЛОНКА ПРИЙШЛА ПІСЛЯ ЧИСЛА, А НЕ ПЕРЕД НИМ.
 *
 * Заміряно 13.10.2026 (`scripts/meteoalarm/zone-coverage.mjs` несе
 * перепис): 52 907 із 57 082 живих кемпінгів — 92.7% — лежать у зоні,
 * яку їхня ж країна вживає в попередженнях. Якби було 40%, ця колонка
 * була б іншим продуктовим рішенням, тож спершу замір.
 *
 * 🔴 `text[]`, А НЕ ОКРЕМА ТАБЛИЦЯ. Кодів на кемпінг одиниці — одна
 * схема в 18 країнах із 20, дві в Бельгії та Хорватії. Таблиця звʼязків
 * заради двох рядків на запис дала б джойн на кожній сторінці й нічого
 * не повернула б: коди ніколи не питають окремо від кемпінга.
 *
 * 🔴 GIN, бо питання завжди «чи перетинається цей масив із кодами
 * попередження» — `warning_areas && ARRAY['EMMA_ID:HR012']`. B-tree на
 * масиві відповідає на рівність цілого масиву, чого ніхто не питає.
 *
 * Порожній масив і NULL означають РІЗНЕ, і матчер на це спирається:
 * NULL — резолвер сюди ще не дійшов; `{}` — дійшов і не знайшов жодної
 * зони. Перше це «не знаю», друге — «знаю, що ніде», і панель каже про
 * них не те саме.
 */
export class WarningAreas1791300000000 implements MigrationInterface {
  name = 'WarningAreas1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "camping_spots" ADD COLUMN "warning_areas" text[]`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_camping_spots_warning_areas" ` +
        `ON "camping_spots" USING GIN ("warning_areas")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_camping_spots_warning_areas"`);
    await queryRunner.query(
      `ALTER TABLE "camping_spots" DROP COLUMN "warning_areas"`,
    );
  }
}
