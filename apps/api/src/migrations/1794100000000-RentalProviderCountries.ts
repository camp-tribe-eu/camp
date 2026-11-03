import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-427: у яких країнах ЄС компанія справді видає машини.
 *
 * 🔴 ЧОМУ ЦЕ ОКРЕМА ТАБЛИЦЯ, А НЕ КОЛОНКА `home_country`. Країна
 * прописки й країни роботи — різні факти, і плутати їх означає брехати
 * читачеві в обидва боки. Заміряно 03.11.2026 на десяти компаніях:
 * прописок лише ЧОТИРИ (DE 6, FR 2, PT 1, FI 1), а країн, де хтось
 * справді видає машини, — ДВАДЦЯТЬ. Тобто сторінка, яка питає «хто
 * здає в Нідерландах», за пропискою дала б нуль, а насправді там сім
 * компаній.
 *
 * 🔴 `UNIQUE (provider_id, country)` — щоб повторний засів не подвоїв
 * перелік, а `ON DELETE CASCADE` — щоб видалена компанія не лишала по
 * собі країн-сиріт, які потім порахуються в «скільки компаній у X».
 */
export class RentalProviderCountries1794100000000 implements MigrationInterface {
  name = 'RentalProviderCountries1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rental_provider_countries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider_id" uuid NOT NULL,
        "country" character varying(2) NOT NULL,
        -- Звідки взято перелік і коли перевірено: каталог порівнює
        -- компанії між собою, тож кожен рядок впливає на чужий бізнес.
        "source_url" character varying,
        "source_checked_on" date,
        CONSTRAINT "PK_rental_provider_countries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rental_provider_countries_provider"
          FOREIGN KEY ("provider_id") REFERENCES "rental_providers"("id")
          ON DELETE CASCADE,
        CONSTRAINT "rental_provider_countries_shape"
          CHECK ("country" ~ '^[A-Z]{2}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_rental_provider_countries_one_per_country"
        ON "rental_provider_countries" ("provider_id", "country")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_rental_provider_countries_country"
        ON "rental_provider_countries" ("country")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rental_provider_countries"`);
  }
}
