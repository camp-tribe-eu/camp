import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-390 — журнал згод: `consent_record`.
 *
 * Ст. 7(1) GDPR вимагає ДОВЕСТИ згоду. Колонка `users.marketing_consent_at`
 * каже «колись погодився», а не «погодився на це», і відкликання лишає по собі
 * `NULL` без історії. Ця таблиця — доказ: хто, на що (вид + версія
 * формулювання з `consent/wordings.ts`), надав чи відкликав, з якого екрана й
 * коли.
 *
 * 🔴 `up()` ЛИШЕ ДОДАЄ. Лише `CREATE`: жодного `DROP`, `ALTER`, `DELETE`,
 * `UPDATE` — жоден наявний рядок і жодна наявна колонка не чіпаються, і
 * `consent.db.spec.ts` рахує `users` до й після, а текст цього `up()` читає
 * так, що додане сюди `DROP` чи `ALTER COLUMN` червонить спек. `users.marketing_consent_at`
 * лишається швидким прапорцем із тією самою семантикою; доказом стає журнал.
 *
 * 🔴 РЯДОК ДОДАЄТЬСЯ, НЕ ПЕРЕПИСУЄТЬСЯ. Відкликання — новий рядок. Тригер
 * `consent_record_append_only` відмовляє на `UPDATE` — це захист ВІД ПОМИЛКИ В
 * КОДІ, а не від облікових даних: роль, що застосовує цю міграцію й працює в
 * рантаймі, ВОЛОДІЄ таблицею, тож може вимкнути чи видалити тригер і змінити,
 * видалити чи обнулити рядки. Від ролі лише з `SELECT, INSERT` відмовилися б
 * усі чотири дії; окрема роль рантайму — рішення про права на проді, і тут не
 * ухвалене. `DELETE` не заборонено навмисно: `ON DELETE CASCADE` від `users`
 * теж є `DELETE`, а стирання акаунта (ст. 17, `purge`) не має впиратись у
 * журнал, що його тримає.
 *
 * 🔴 `id` — ПОСЛІДОВНІСТЬ, НЕ `uuid`. «Поточний стан» — це останній рядок, а
 * «останній» за часом неоднозначний, коли два рядки мають одну позначку.
 *
 * 🔴 `kind` І `source` — `text` З `CHECK`, НЕ `ENUM`. Як і `auth_tokens_kind`:
 * перелік змінюється міграцією, що видно, а не `ALTER TYPE`, який у частині
 * версій Postgres не йде в транзакції. Види `photo_*` і джерело `moderation`
 * названі в картці й чекають інтерфейсу подачі фото (CAMP-86); без них
 * довелось би переписувати обмеження, тобто робити саме `DROP CONSTRAINT`,
 * якого цей файл уникає.
 *
 * `down()` прибирає лише своє: тригер, функцію, таблицю.
 */
export class ConsentRecord1792900000000 implements MigrationInterface {
  name = 'ConsentRecord1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS consent_record (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        kind text NOT NULL,
        granted boolean NOT NULL,
        wording_key text NOT NULL,
        wording_version integer NOT NULL,
        source text NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT consent_record_kind CHECK (kind IN (
          'newsletter', 'photo_publish', 'photo_sublicense', 'photo_attribution'
        )),
        CONSTRAINT consent_record_source CHECK (source IN (
          'signup', 'settings', 'moderation'
        )),
        CONSTRAINT consent_record_version CHECK (wording_version >= 1)
      )
    `);
    // Вивантаження й «поточний стан» читають рядки однієї людини за часом.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_consent_record_user
        ON consent_record (user_id, recorded_at, id)
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION consent_record_refuse_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'consent_record is append-only: a change is a new row'
          USING ERRCODE = 'restrict_violation';
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER consent_record_append_only
        BEFORE UPDATE ON consent_record
        FOR EACH ROW EXECUTE FUNCTION consent_record_refuse_update()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Лише те, що створив `up()`.
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS consent_record_append_only ON consent_record`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS consent_record_refuse_update()`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS consent_record`);
  }
}
