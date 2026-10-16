import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-229 — налаштування акаунта: зміна пошти.
 *
 * Пароль і згода на листи нічого в схемі не потребують: `password_hash` і
 * `marketing_consent_at` уже є. Зміна ПОШТИ потребує, і саме тому ця
 * міграція існує.
 *
 * 🔴 НОВА АДРЕСА ЖИВЕ В ТОКЕНІ, А НЕ В `users`. Спокусливо дописати
 * `users.pending_email` — і це була б помилка: тоді адреса, яку ще ніхто
 * не підтвердив, лежить у рядку людини й може випадково поїхати в будь-яку
 * вибірку, що робить `SELECT *`. Токен же зникає разом із посиланням, і
 * його видно лише тому коду, що вміє клікнуті посилання.
 *
 * 🔴 `auth_tokens_new_email` — ЕКВІВАЛЕНТНІСТЬ, А НЕ «NOT NULL ДЛЯ ОДНОГО
 * ВИДУ». Умова `(kind = 'change_email') = (new_email IS NOT NULL)` забороняє
 * ОБИДВІ помилки одразу:
 *
 *   * `change_email` без адреси — посилання, яке нема куди застосувати, і
 *     код, що спробує, поставить людині `email = NULL`;
 *   * `verify_email` чи `reset_password` З адресою — рядок, який виглядає
 *     як запит на зміну пошти для будь-кого, хто читає таблицю.
 *
 * Перевірка на нормалізацію та сама, що й для `users.email`
 * (`users_email_normalised`): адреса, записана інакше, перестала б збігатися
 * сама з собою після підтвердження.
 */
export class AccountSettings1792000000000 implements MigrationInterface {
  name = 'AccountSettings1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth_tokens
        ADD COLUMN IF NOT EXISTS new_email varchar(320)
    `);

    // Старий CHECK знав два види; третій без цього просто не запишеться.
    await queryRunner.query(`
      ALTER TABLE auth_tokens
        DROP CONSTRAINT IF EXISTS auth_tokens_kind
    `);
    await queryRunner.query(`
      ALTER TABLE auth_tokens
        ADD CONSTRAINT auth_tokens_kind
        CHECK (kind IN ('verify_email', 'reset_password', 'change_email'))
    `);

    await queryRunner.query(`
      ALTER TABLE auth_tokens
        DROP CONSTRAINT IF EXISTS auth_tokens_new_email
    `);
    await queryRunner.query(`
      ALTER TABLE auth_tokens
        ADD CONSTRAINT auth_tokens_new_email
        CHECK ((kind = 'change_email') = (new_email IS NOT NULL))
    `);

    await queryRunner.query(`
      ALTER TABLE auth_tokens
        DROP CONSTRAINT IF EXISTS auth_tokens_new_email_normalised
    `);
    await queryRunner.query(`
      ALTER TABLE auth_tokens
        ADD CONSTRAINT auth_tokens_new_email_normalised
        CHECK (new_email IS NULL OR new_email = lower(btrim(new_email)))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 🔴 Спершу прибрати рядки нового виду, інакше старий CHECK не стане:
    // він їх не допускає, і ALTER впаде на півдорозі.
    await queryRunner.query(
      `DELETE FROM auth_tokens WHERE kind = 'change_email'`,
    );
    await queryRunner.query(`
      ALTER TABLE auth_tokens
        DROP CONSTRAINT IF EXISTS auth_tokens_new_email_normalised
    `);
    await queryRunner.query(`
      ALTER TABLE auth_tokens
        DROP CONSTRAINT IF EXISTS auth_tokens_new_email
    `);
    await queryRunner.query(`
      ALTER TABLE auth_tokens
        DROP CONSTRAINT IF EXISTS auth_tokens_kind
    `);
    await queryRunner.query(`
      ALTER TABLE auth_tokens
        ADD CONSTRAINT auth_tokens_kind
        CHECK (kind IN ('verify_email', 'reset_password'))
    `);
    await queryRunner.query(`
      ALTER TABLE auth_tokens DROP COLUMN IF EXISTS new_email
    `);
  }
}
