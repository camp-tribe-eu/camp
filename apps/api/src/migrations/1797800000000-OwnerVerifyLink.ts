import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-505: самоверифікація власника по домену пошти — посилання замість
 * ручної черги.
 *
 * 🔴 ТА САМА ТАБЛИЦЯ, А НЕ ДРУГА. Підтверджений власник — це рядок у
 * `spot_claims` з `used_at IS NOT NULL` (CAMP-51), і саме його читають
 * `OwnerListingService` та частковий унікальний індекс «один власник на
 * кемпінг». Друга таблиця означала б два місця, де вирішується, хто
 * власник, і рано чи пізно вони б розійшлись. Нова колонка лише каже, ЯК
 * доведено.
 *
 * 🔴 `code_hash` ЛИШАЄТЬСЯ ЄДИНИМ МІСЦЕМ СЕКРЕТУ. Для `link` там лежить
 * sha256 токена з посилання, не сам токен: дамп таблиці не має бути
 * набором готових «забрати чужий кемпінг» — те саме правило, що для
 * `auth_tokens.token_hash`. Назву не міняємо: перейменування колонки в
 * живій таблиці — це ще один крок міграції, який нічого не захищає.
 *
 * 🔴 АДРЕСИ В ТАБЛИЦІ ПО-ПРЕЖНЬОМУ НЕМАЄ. Людина вводить пошту, ми
 * порівнюємо її з даними кемпінгу й надсилаємо лист; у рядок іде лише
 * маска (`i***@c***.de`, її тримає CHECK із 1794300000000) і підстава
 * збігу. Лічильник листів на адресу живе в пам'яті процесу, не тут:
 * рахувати в базі означало б зберігати адресу або її хеш.
 *
 * 🔴 `basis` ОБОВʼЯЗКОВИЙ РІВНО ДЛЯ `link`. Рядок «підтверджено по посиланню»
 * без підстави — це право, про яке неможливо сказати, звідки воно; база
 * цього не пропускає, а не код.
 */
export class OwnerVerifyLink1797800000000 implements MigrationInterface {
  name = 'OwnerVerifyLink1797800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "spot_claims"
        ADD COLUMN "method" character varying(16) NOT NULL DEFAULT 'osm_code',
        ADD COLUMN "basis" character varying(16),
        ADD CONSTRAINT "spot_claims_method_known"
          CHECK ("method" IN ('osm_code', 'link')),
        ADD CONSTRAINT "spot_claims_basis_known"
          CHECK ("basis" IS NULL OR "basis" IN
            ('website-domain', 'listed-email')),
        ADD CONSTRAINT "spot_claims_basis_iff_link"
          CHECK (("method" = 'link') = ("basis" IS NOT NULL))
    `);

    // Пошук за хешем токена. Унікальний: два рядки з одним хешем означали б
    // колізію sha256 або двічі вставлений токен — обидва не мають бути.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_spot_claims_link_hash"
        ON "spot_claims" ("code_hash") WHERE "method" = 'link'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_spot_claims_link_hash"`);
    await queryRunner.query(`
      ALTER TABLE "spot_claims"
        DROP CONSTRAINT "spot_claims_basis_iff_link",
        DROP CONSTRAINT "spot_claims_basis_known",
        DROP CONSTRAINT "spot_claims_method_known",
        DROP COLUMN "basis",
        DROP COLUMN "method"
    `);
  }
}
