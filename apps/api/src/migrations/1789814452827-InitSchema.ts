import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1789814452827 implements MigrationInterface {
    name = 'InitSchema1789814452827'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "display_name" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."camping_spots_type_enum" AS ENUM('free', 'paid', 'wild', 'camper_stop', 'rv_park')`);
        await queryRunner.query(`CREATE TABLE "camping_spots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "country" character varying NOT NULL, "region" character varying, "slug" character varying NOT NULL, "type" "public"."camping_spots_type_enum" NOT NULL, "amenities" jsonb NOT NULL DEFAULT '{}', "location" geometry(Point,4326) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f9e4039d701a1091a9b0f939217" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_910c49fa50e4a14d6594faffd2" ON "camping_spots"  ("country") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f5f2ac3fe18b0eb61c5e28be45" ON "camping_spots"  ("slug") `);
        await queryRunner.query(`CREATE INDEX "IDX_1370b4a5d404d9e2c323252663" ON "camping_spots" USING gist ("location") `);
        await queryRunner.query(`CREATE TABLE "route_points" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "route_id" uuid NOT NULL, "sequence" integer NOT NULL, "name" character varying, "location" geometry(Point,4326) NOT NULL, CONSTRAINT "PK_9684d129d71ff38906e7cb08c68" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b56f581579c883f91084a59e71" ON "route_points" USING gist ("location") `);
        await queryRunner.query(`CREATE TABLE "routes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "slug" character varying NOT NULL, "country" character varying NOT NULL, "description" text, "duration_days" integer NOT NULL, "distance_km" double precision, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_76100511cdfa1d013c859f01d8b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6f526fff54d3871572b3a6031d" ON "routes"  ("slug") `);
        await queryRunner.query(`CREATE INDEX "IDX_a6aeb9ed2345c9e6f882f2f8f3" ON "routes"  ("country") `);
        await queryRunner.query(`CREATE TABLE "trip_stops" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trip_id" uuid NOT NULL, "camping_spot_id" uuid, "sequence" integer NOT NULL, "arrival_date" date, CONSTRAINT "PK_876633f878970267cb0dc525984" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "trips" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "name" character varying NOT NULL, "start_date" date, "end_date" date, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f71c231dee9c05a9522f9e840f5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "route_points" ADD CONSTRAINT "FK_3831bd2727c131855bcd8064d2a" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD CONSTRAINT "FK_5cb5ec6432abdf6f1e1c3a0970c" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD CONSTRAINT "FK_408333255b8753e47052f574baa" FOREIGN KEY ("camping_spot_id") REFERENCES "camping_spots"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trips" ADD CONSTRAINT "FK_c32589af53db811884889e03663" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trips" DROP CONSTRAINT "FK_c32589af53db811884889e03663"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP CONSTRAINT "FK_408333255b8753e47052f574baa"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP CONSTRAINT "FK_5cb5ec6432abdf6f1e1c3a0970c"`);
        await queryRunner.query(`ALTER TABLE "route_points" DROP CONSTRAINT "FK_3831bd2727c131855bcd8064d2a"`);
        await queryRunner.query(`DROP TABLE "trips"`);
        await queryRunner.query(`DROP TABLE "trip_stops"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a6aeb9ed2345c9e6f882f2f8f3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6f526fff54d3871572b3a6031d"`);
        await queryRunner.query(`DROP TABLE "routes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b56f581579c883f91084a59e71"`);
        await queryRunner.query(`DROP TABLE "route_points"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1370b4a5d404d9e2c323252663"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f5f2ac3fe18b0eb61c5e28be45"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_910c49fa50e4a14d6594faffd2"`);
        await queryRunner.query(`DROP TABLE "camping_spots"`);
        await queryRunner.query(`DROP TYPE "public"."camping_spots_type_enum"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
