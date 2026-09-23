import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-92: what the reader's browser reported, and nothing about the reader.
 *
 * 🔴 The columns this table does NOT have are the design. No IP, no
 * session, no user, no cookie — an IP address is personal data under
 * GDPR, and collecting one to find a JavaScript bug would be processing
 * we have no basis for and no use for. The rate limit on the endpoint is
 * keyed on the fingerprint instead, which stops the abuse this endpoint
 * actually invites (a flood of identical rows) without storing anybody.
 *
 * `fingerprint` is message plus the first stack frame: the unit a human
 * triages. Indexed, because the first question asked of this table is
 * always "how many distinct problems", never "show me all rows".
 *
 * `received_at` is indexed for the same reason retention needs it: rows
 * older than a reporting window are noise, and deleting them has to be
 * cheap enough that it actually happens.
 */
export class ClientErrors1790140800000 implements MigrationInterface {
  name = 'ClientErrors1790140800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "client_errors" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" character varying(16) NOT NULL,
        "message" text NOT NULL,
        "stack" text,
        "path" character varying(512) NOT NULL,
        "source" character varying(512),
        "line" integer,
        "user_agent" character varying(512) NOT NULL,
        "since_load_ms" integer NOT NULL,
        "fingerprint" character varying(512) NOT NULL,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_client_errors" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_client_errors_fingerprint" ON "client_errors" ("fingerprint")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_client_errors_received_at" ON "client_errors" ("received_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_client_errors_path" ON "client_errors" ("path")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "client_errors"`);
  }
}
