import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-427: прокатні компанії — каталог, сервіси, парк і профілі відгуків.
 *
 * 🔴 ЧОГО ТУТ НЕМАЄ, І ЦЕ ДИЗАЙН. Жодної ціни й жодної доступності: ми
 * возимо читача афіліатним посиланням, а не стрічкою цін, і будь-яке
 * число, схоже на ціну, протухне за тиждень і стане оманливим у сенсі
 * ст. 6(1) UCPD. Зберігаємо те, що не міняється щотижня.
 *
 * 🔴 ЧОМУ ЧИСЛО РЕЙТИНГУ ЗАКРИТЕ ОБМЕЖЕННЯМ БАЗИ, А НЕ ЛИШЕ ПРАВИЛОМ У
 * КОДІ. Умови Trustpilot (прочитані в першоджерелі 02.11.2026) забороняють
 * і збір, і показ TrustScore без їхнього прямого дозволу; Google дозволяє
 * показ лише через платний Places API. Рішення власника того ж дня:
 * показуємо назву джерела й посилання, цифри — ні.
 *
 * Правило, яке живе лише в коді сторінки, обходиться одним INSERT. Тому
 * `rental_provider_review_profiles_figures_need_permission` стоїть у схемі:
 * покласти рейтинг у рядок без дати письмового дозволу неможливо фізично.
 * Коли дозвіл прийде — заповнюємо `permission_confirmed_on`, і та сама
 * перевірка одразу пропускає цифри.
 */
export class RentalProviders1794000000000 implements MigrationInterface {
  name = 'RentalProviders1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."rental_service_availability_enum"
        AS ENUM ('included', 'extra', 'unavailable')
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."rental_review_source_enum"
        AS ENUM ('trustpilot', 'google')
    `);

    await queryRunner.query(`
      CREATE TABLE "rental_providers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug" character varying NOT NULL,
        "name" character varying NOT NULL,
        "legal_name" character varying,
        "registration_number" character varying,
        "home_country" character varying(2) NOT NULL,
        "website" character varying,
        "email" character varying,
        "phone" character varying,
        "declared_depot_count" integer,
        "declared_fleet_size" integer,
        "founded_year" integer,
        -- 🔴 Звідки взято числа й коли перевірено. Сторінка каталогу
        -- порівнює компанії між собою, тобто кожне число впливає на чужий
        -- бізнес; без джерела ми не доведемо нічого.
        "source_url" character varying,
        "source_checked_on" date,
        "status" "public"."content_status_enum" NOT NULL DEFAULT 'draft',
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rental_providers" PRIMARY KEY ("id"),
        -- Країна — рівно дві великі літери: ISO-3166-1 alpha-2 і нічого
        -- іншого. Один «UK» замість «GB» ламає будь-яке групування мовчки.
        CONSTRAINT "rental_providers_home_country"
          CHECK ("home_country" ~ '^[A-Z]{2}$'),
        CONSTRAINT "rental_providers_founded_year"
          CHECK ("founded_year" IS NULL
                 OR ("founded_year" BETWEEN 1900 AND 2100)),
        CONSTRAINT "rental_providers_counts_not_negative"
          CHECK (("declared_depot_count" IS NULL OR "declared_depot_count" >= 0)
             AND ("declared_fleet_size" IS NULL OR "declared_fleet_size" >= 0))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_rental_providers_slug" ON "rental_providers" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_providers_home_country" ON "rental_providers" ("home_country")`,
    );

    await queryRunner.query(`
      CREATE TABLE "rental_provider_translations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider_id" uuid NOT NULL,
        "language_code" character varying(16) NOT NULL,
        "intro" text,
        "what_to_know" text,
        CONSTRAINT "PK_rental_provider_translations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rental_provider_translations_provider"
          FOREIGN KEY ("provider_id") REFERENCES "rental_providers"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_rental_provider_translations_one_per_language"
        ON "rental_provider_translations" ("provider_id", "language_code")
    `);

    await queryRunner.query(`
      CREATE TABLE "rental_provider_services" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider_id" uuid NOT NULL,
        -- Код зі словника в коді, не enum у схемі: словник росте щотижня,
        -- а міграція на кожне нове слово — ціна, яку обходять тихо.
        "code" character varying(64) NOT NULL,
        "availability" "public"."rental_service_availability_enum" NOT NULL,
        "note" text,
        "source_url" character varying,
        "source_checked_on" date,
        CONSTRAINT "PK_rental_provider_services" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rental_provider_services_provider"
          FOREIGN KEY ("provider_id") REFERENCES "rental_providers"("id")
          ON DELETE CASCADE,
        CONSTRAINT "rental_provider_services_code_shape"
          CHECK ("code" ~ '^[a-z0-9_]+$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_rental_provider_services_one_per_code"
        ON "rental_provider_services" ("provider_id", "code")
    `);

    await queryRunner.query(`
      CREATE TABLE "rental_provider_vehicles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "slug" character varying(96) NOT NULL,
        "camper_type_id" uuid,
        -- 🔴 МІСЦЯ ДЛЯ СНУ Й МІСЦЯ З ПАСКАМИ — РІЗНІ ЧИСЛА. Сплутати їх
        -- означає посадити в машину більше людей, ніж вона може везти
        -- законно, тому дві колонки, а не одна «місткість».
        "berths" integer,
        "belted_seats" integer,
        "length_cm" integer,
        "source_url" character varying,
        "source_checked_on" date,
        CONSTRAINT "PK_rental_provider_vehicles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rental_provider_vehicles_provider"
          FOREIGN KEY ("provider_id") REFERENCES "rental_providers"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_rental_provider_vehicles_camper_type"
          FOREIGN KEY ("camper_type_id") REFERENCES "camper_types"("id")
          ON DELETE SET NULL,
        CONSTRAINT "rental_provider_vehicles_counts"
          CHECK (("berths" IS NULL OR "berths" BETWEEN 1 AND 12)
             AND ("belted_seats" IS NULL OR "belted_seats" BETWEEN 1 AND 12)),
        CONSTRAINT "rental_provider_vehicles_length"
          CHECK ("length_cm" IS NULL OR "length_cm" BETWEEN 300 AND 1200)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_rental_provider_vehicles_one_per_slug"
        ON "rental_provider_vehicles" ("provider_id", "slug")
    `);

    await queryRunner.query(`
      CREATE TABLE "rental_provider_review_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider_id" uuid NOT NULL,
        "source" "public"."rental_review_source_enum" NOT NULL,
        "profile_url" character varying NOT NULL,
        -- Дата письмового дозволу показувати цифру. Порожньо = немає.
        "permission_confirmed_on" date,
        "rating" numeric(2,1),
        "review_count" integer,
        CONSTRAINT "PK_rental_provider_review_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rental_provider_review_profiles_provider"
          FOREIGN KEY ("provider_id") REFERENCES "rental_providers"("id")
          ON DELETE CASCADE,
        -- 🔴 ОСЬ ЦЕ — ГОЛОВНЕ В ЦІЙ МІГРАЦІЇ. Цифра не може існувати в
        -- рядку, де немає дати дозволу. Правило в коді сторінки обходиться
        -- одним INSERT; це — ні.
        CONSTRAINT "rental_provider_review_profiles_figures_need_permission"
          CHECK ("permission_confirmed_on" IS NOT NULL
                 OR ("rating" IS NULL AND "review_count" IS NULL)),
        CONSTRAINT "rental_provider_review_profiles_rating_range"
          CHECK ("rating" IS NULL OR ("rating" BETWEEN 0 AND 5)),
        CONSTRAINT "rental_provider_review_profiles_count_not_negative"
          CHECK ("review_count" IS NULL OR "review_count" >= 0),
        -- Посилання веде на сторінку, а не кудись: https і нічого іншого.
        CONSTRAINT "rental_provider_review_profiles_url_shape"
          CHECK ("profile_url" ~ '^https://')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_rental_provider_review_profiles_one_per_source"
        ON "rental_provider_review_profiles" ("provider_id", "source")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rental_provider_review_profiles"`);
    await queryRunner.query(`DROP TABLE "rental_provider_vehicles"`);
    await queryRunner.query(`DROP TABLE "rental_provider_services"`);
    await queryRunner.query(`DROP TABLE "rental_provider_translations"`);
    await queryRunner.query(`DROP TABLE "rental_providers"`);
    await queryRunner.query(`DROP TYPE "public"."rental_review_source_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."rental_service_availability_enum"`,
    );
  }
}
