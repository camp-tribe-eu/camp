import { MigrationInterface, QueryRunner } from "typeorm";

export class ContentCollections1790002922176 implements MigrationInterface {
    name = 'ContentCollections1790002922176'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "languages" ("code" character varying(16) NOT NULL, "name" character varying NOT NULL, "direction" character varying(3) NOT NULL DEFAULT 'ltr', "published" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_7397752718d1c9eb873722ec9b2" PRIMARY KEY ("code"))`);
        await queryRunner.query(`CREATE TYPE "public"."guides_status_enum" AS ENUM('draft', 'review', 'published', 'archived')`);
        await queryRunner.query(`CREATE TABLE "guides" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying NOT NULL, "category" character varying NOT NULL, "status" "public"."guides_status_enum" NOT NULL DEFAULT 'draft', "author_name" character varying, "author_credentials" character varying, "reading_minutes" integer, "facts_checked_at" date, "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8de34e682c2201d625cf95c1266" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_09f2822806febb8266431100eb" ON "guides"  ("slug") `);
        await queryRunner.query(`CREATE TABLE "guide_translations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "guide_id" uuid NOT NULL, "language_code" character varying(16) NOT NULL, "title" character varying NOT NULL, "summary" text, "body" text, CONSTRAINT "PK_6d960e1d9d67f26248d132467ff" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8bd75a2534fc313e8138790a64" ON "guide_translations"  ("guide_id", "language_code") `);
        await queryRunner.query(`CREATE TYPE "public"."legal_pages_status_enum" AS ENUM('draft', 'review', 'published', 'archived')`);
        await queryRunner.query(`CREATE TABLE "legal_pages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying NOT NULL, "version" character varying(16) NOT NULL DEFAULT '1.0', "effective_from" date, "status" "public"."legal_pages_status_enum" NOT NULL DEFAULT 'draft', "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b9f9917992753b5e65488b8bd7e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f1f163cfa770af83882769be57" ON "legal_pages"  ("slug") `);
        await queryRunner.query(`CREATE TABLE "legal_page_translations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "legal_page_id" uuid NOT NULL, "language_code" character varying(16) NOT NULL, "title" character varying NOT NULL, "plain_summary" text, "body" text, CONSTRAINT "PK_5bd60706b4bae778d723b2b6a0e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_610cdcccf2a8a314cef16b67b7" ON "legal_page_translations"  ("legal_page_id", "language_code") `);
        await queryRunner.query(`CREATE TYPE "public"."featured_blocks_kind_enum" AS ENUM('route', 'camping_spot', 'guide', 'rental_city')`);
        await queryRunner.query(`CREATE TABLE "featured_blocks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "kind" "public"."featured_blocks_kind_enum" NOT NULL, "target_id" character varying NOT NULL, "position" integer NOT NULL DEFAULT '0', "note" text, "active_from" TIMESTAMP WITH TIME ZONE, "active_to" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e708bf411089c87cb28ffd0543a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."camper_types_licence_class_enum" AS ENUM('B', 'C1', 'B_or_C1', 'trailer')`);
        await queryRunner.query(`CREATE TYPE "public"."camper_types_status_enum" AS ENUM('draft', 'review', 'published', 'archived')`);
        await queryRunner.query(`CREATE TABLE "camper_types" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying NOT NULL, "position" integer NOT NULL DEFAULT '0', "length_min_m" numeric(3,1), "length_max_m" numeric(3,1), "height_m" numeric(3,1), "mass_t" numeric(3,2), "licence_class" "public"."camper_types_licence_class_enum" NOT NULL, "sleeps_min" integer, "sleeps_max" integer, "has_toilet" boolean NOT NULL DEFAULT false, "has_shower" boolean NOT NULL DEFAULT false, "fuel_estimate_l_100km" numeric(4,1), "status" "public"."camper_types_status_enum" NOT NULL DEFAULT 'draft', CONSTRAINT "PK_4efae8fc773a34ac2e2e9087dbb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8db3d1cdd1347966305d6197fe" ON "camper_types"  ("slug") `);
        await queryRunner.query(`CREATE TABLE "camper_type_translations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "camper_type_id" uuid NOT NULL, "language_code" character varying(16) NOT NULL, "name" character varying NOT NULL, "alt_names" character varying, "description" text, CONSTRAINT "PK_d4bb599f677553423063cfb0e48" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3511478b610d69ebbdac667b8d" ON "camper_type_translations"  ("camper_type_id", "language_code") `);
        await queryRunner.query(`CREATE TYPE "public"."rental_cities_status_enum" AS ENUM('draft', 'review', 'published', 'archived')`);
        await queryRunner.query(`CREATE TABLE "rental_cities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying NOT NULL, "country" character varying(2) NOT NULL, "lat" numeric(9,6), "lon" numeric(9,6), "partner_count" integer NOT NULL DEFAULT '0', "campsite_count_100km" integer NOT NULL DEFAULT '0', "route_count" integer NOT NULL DEFAULT '0', "status" "public"."rental_cities_status_enum" NOT NULL DEFAULT 'draft', "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4d66b70a5d6c59d16089ede79cb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_191fb22eb231cb30dd2341c3df" ON "rental_cities"  ("slug") `);
        await queryRunner.query(`CREATE INDEX "IDX_1c3a83819b26e113d3691c683d" ON "rental_cities"  ("country") `);
        await queryRunner.query(`CREATE TABLE "rental_city_translations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "rental_city_id" uuid NOT NULL, "language_code" character varying(16) NOT NULL, "name" character varying NOT NULL, "intro" text, "local_tips" text, CONSTRAINT "PK_9da2fd3af4c76b54b10c056265f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e3492a8ffde082e7c994191f0f" ON "rental_city_translations"  ("rental_city_id", "language_code") `);
        await queryRunner.query(`CREATE TYPE "public"."photo_submissions_source_enum" AS ENUM('owner', 'community')`);
        await queryRunner.query(`CREATE TYPE "public"."photo_submissions_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
        await queryRunner.query(`CREATE TABLE "photo_submissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "camping_spot_id" uuid NOT NULL, "submitted_by_id" uuid, "storage_key" character varying NOT NULL, "source" "public"."photo_submissions_source_enum" NOT NULL, "shot_on" date NOT NULL, "licence_publish" boolean NOT NULL DEFAULT false, "licence_sublicense" boolean NOT NULL DEFAULT false, "licence_attribution_name" character varying, "status" "public"."photo_submissions_status_enum" NOT NULL DEFAULT 'pending', "rejection_reason" text, "reviewed_at" TIMESTAMP WITH TIME ZONE, "reviewed_by_directus_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_188a30c5a4ea9c7c835935031cb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_64492a9394e443a07bf07da390" ON "photo_submissions"  ("camping_spot_id") `);
        await queryRunner.query(`CREATE TYPE "public"."reviews_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
        await queryRunner.query(`CREATE TABLE "reviews" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "camping_spot_id" uuid NOT NULL, "author_id" uuid, "rating" integer NOT NULL, "body" text, "stayed_on" date, "status" "public"."reviews_status_enum" NOT NULL DEFAULT 'pending', "rejection_reason" text, "reviewed_at" TIMESTAMP WITH TIME ZONE, "reviewed_by_directus_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_231ae565c273ee700b283f15c1d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2df68405490b4221b3b8beaf02" ON "reviews"  ("camping_spot_id") `);
        await queryRunner.query(`ALTER TABLE "guide_translations" ADD CONSTRAINT "FK_08d6336452a423ad128449a1743" FOREIGN KEY ("guide_id") REFERENCES "guides"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "legal_page_translations" ADD CONSTRAINT "FK_63774dc983d8cfbc4b8a30c15cf" FOREIGN KEY ("legal_page_id") REFERENCES "legal_pages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "camper_type_translations" ADD CONSTRAINT "FK_7c916430df317e2d22fe4cc5b58" FOREIGN KEY ("camper_type_id") REFERENCES "camper_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "rental_city_translations" ADD CONSTRAINT "FK_0d363a8dbb68776dc360f56c43f" FOREIGN KEY ("rental_city_id") REFERENCES "rental_cities"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "photo_submissions" ADD CONSTRAINT "FK_64492a9394e443a07bf07da390b" FOREIGN KEY ("camping_spot_id") REFERENCES "camping_spots"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "photo_submissions" ADD CONSTRAINT "FK_26bbbb934cffab7e37c8bcc37c0" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_2df68405490b4221b3b8beaf027" FOREIGN KEY ("camping_spot_id") REFERENCES "camping_spots"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_7efc8ac1a6389e4e9317435ad2b" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        // Rating is 1-5. Enforced in the database, not only in the entity:
        // Directus writes straight to these tables, so a check that lives
        // in TypeScript would not be applied to an editor's edit.
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "CHK_reviews_rating_1_5" CHECK ("rating" >= 1 AND "rating" <= 5)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "CHK_reviews_rating_1_5"`);
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_7efc8ac1a6389e4e9317435ad2b"`);
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_2df68405490b4221b3b8beaf027"`);
        await queryRunner.query(`ALTER TABLE "photo_submissions" DROP CONSTRAINT "FK_26bbbb934cffab7e37c8bcc37c0"`);
        await queryRunner.query(`ALTER TABLE "photo_submissions" DROP CONSTRAINT "FK_64492a9394e443a07bf07da390b"`);
        await queryRunner.query(`ALTER TABLE "rental_city_translations" DROP CONSTRAINT "FK_0d363a8dbb68776dc360f56c43f"`);
        await queryRunner.query(`ALTER TABLE "camper_type_translations" DROP CONSTRAINT "FK_7c916430df317e2d22fe4cc5b58"`);
        await queryRunner.query(`ALTER TABLE "legal_page_translations" DROP CONSTRAINT "FK_63774dc983d8cfbc4b8a30c15cf"`);
        await queryRunner.query(`ALTER TABLE "guide_translations" DROP CONSTRAINT "FK_08d6336452a423ad128449a1743"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2df68405490b4221b3b8beaf02"`);
        await queryRunner.query(`DROP TABLE "reviews"`);
        await queryRunner.query(`DROP TYPE "public"."reviews_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_64492a9394e443a07bf07da390"`);
        await queryRunner.query(`DROP TABLE "photo_submissions"`);
        await queryRunner.query(`DROP TYPE "public"."photo_submissions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."photo_submissions_source_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e3492a8ffde082e7c994191f0f"`);
        await queryRunner.query(`DROP TABLE "rental_city_translations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1c3a83819b26e113d3691c683d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_191fb22eb231cb30dd2341c3df"`);
        await queryRunner.query(`DROP TABLE "rental_cities"`);
        await queryRunner.query(`DROP TYPE "public"."rental_cities_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3511478b610d69ebbdac667b8d"`);
        await queryRunner.query(`DROP TABLE "camper_type_translations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8db3d1cdd1347966305d6197fe"`);
        await queryRunner.query(`DROP TABLE "camper_types"`);
        await queryRunner.query(`DROP TYPE "public"."camper_types_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."camper_types_licence_class_enum"`);
        await queryRunner.query(`DROP TABLE "featured_blocks"`);
        await queryRunner.query(`DROP TYPE "public"."featured_blocks_kind_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_610cdcccf2a8a314cef16b67b7"`);
        await queryRunner.query(`DROP TABLE "legal_page_translations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f1f163cfa770af83882769be57"`);
        await queryRunner.query(`DROP TABLE "legal_pages"`);
        await queryRunner.query(`DROP TYPE "public"."legal_pages_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8bd75a2534fc313e8138790a64"`);
        await queryRunner.query(`DROP TABLE "guide_translations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_09f2822806febb8266431100eb"`);
        await queryRunner.query(`DROP TABLE "guides"`);
        await queryRunner.query(`DROP TYPE "public"."guides_status_enum"`);
        await queryRunner.query(`DROP TABLE "languages"`);
    }

}
