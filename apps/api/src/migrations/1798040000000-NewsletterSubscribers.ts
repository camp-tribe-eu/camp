import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-441, пункт 7 ревʼю: поле «підписатися на листи» у підвалі сайту.
 * Це таблиця, у яку воно пише — і нічого більше.
 *
 * 🔴 `up()` ЛИШЕ ДОДАЄ: одна `CREATE TABLE` і два індекси; жоден наявний
 * рядок, колонка чи обмеження не чіпається.
 *
 * 🔴 ТАБЛИЦЯ НЕ ЗАРЕЄСТРОВАНА В DIRECTUS І НЕ МАЄ БУТИ: інстанс стоїть на
 * 25 із 25 колекцій, а зареєстрована колекція витрачає слот, навіть
 * схована. Адреси читаються лише кодом API; `apps/cms/directus-config.json`
 * цією карткою не змінюється.
 *
 * 🔴 ЧОГО ТАБЛИЦЯ НЕ МОЖЕ ТРИМАТИ — обмеженнями, а не домовленістю:
 *   · адресу не в нижньому регістрі (`newsletter_email_lower`) і довшу за 254;
 *   · стан поза `pending` / `confirmed` / `unsubscribed`;
 *   · СИРИЙ токен: колонок під нього немає, лише хеш sha256 у hex
 *     (64 символи, `CHECK`) — дамп таблиці не є набором робочих посилань
 *     «підтвердь / відпиши будь-кого»;
 *   · IP, браузер, акаунт: колонок немає. Заявка не повʼязана з `users`.
 *
 * `confirm_token_hash` і `confirm_token_expires_at` живуть, поки адреса
 * pending, і зануляються при підтвердженні чи відписці: посилання
 * одноразове. `unsubscribe_token_hash` довгий, без строку.
 *
 * `down()` знімає лише те, що створив `up()`.
 */
export class NewsletterSubscribers1798040000000 implements MigrationInterface {
  name = 'NewsletterSubscribers1798040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        email text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        confirm_token_hash text,
        confirm_token_expires_at timestamptz,
        unsubscribe_token_hash text,
        created_at timestamptz NOT NULL DEFAULT now(),
        confirmed_at timestamptz,
        unsubscribed_at timestamptz,
        CONSTRAINT newsletter_subscribers_email_unique UNIQUE (email),
        CONSTRAINT newsletter_email_lower CHECK (email = lower(email)),
        CONSTRAINT newsletter_email_length
          CHECK (char_length(email) BETWEEN 3 AND 254),
        CONSTRAINT newsletter_status
          CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
        CONSTRAINT newsletter_confirm_hash_shape
          CHECK (confirm_token_hash IS NULL OR confirm_token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT newsletter_unsubscribe_hash_shape
          CHECK (unsubscribe_token_hash IS NULL OR unsubscribe_token_hash ~ '^[0-9a-f]{64}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_confirm_hash
        ON newsletter_subscribers (confirm_token_hash)
        WHERE confirm_token_hash IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_unsubscribe_hash
        ON newsletter_subscribers (unsubscribe_token_hash)
        WHERE unsubscribe_token_hash IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS newsletter_subscribers`);
  }
}
