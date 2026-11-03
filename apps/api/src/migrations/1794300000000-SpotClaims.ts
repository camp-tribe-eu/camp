import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-51 «Claim your listing»: доказ володіння кемпінгом.
 *
 * 🔴 ПРЕМІСА КАРТКИ ЗАМІРЯНА. Картка каже «~10 000 адрес у нас уже є»
 * (Overpass, 19.09.2026). Власний запит 03.11.2026 по 63 159 рядках:
 * `contact ? 'email'` → **11 628**. Канал ширший, ніж обіцяно, і це
 * єдина підстава будувати потік — без адрес у нього немає входу.
 *
 * 🔴 ГРАНТ, А НЕ ДРУГИЙ ТИП КОРИСТУВАЧА — урок usabmx, той самий, що
 * записаний в `auth/ownership.ts`. Підтверджений власник — це звичайний
 * акаунт плюс РЯДОК тут. Жодної ролі, жодної другої таблиці людей.
 *
 * 🔴 ЧОМУ ЛЕЖИТЬ ХЕШ, А НЕ КОД. Те саме правило, що для
 * `auth_tokens.token_hash` і `sessions`: дамп цієї таблиці не має бути
 * набором готових «забрати чужий кемпінг».
 *
 * 🔴 І ЧОМУ МАСКА, А НЕ АДРЕСА. Адреса вже лежить у
 * `camping_spots.contact` — другої копії тут не треба, а `i***@c***.de`
 * вистачає, щоб людина впізнала, куди пішов лист. Кінцева точка, яка
 * віддає адресу, перетворює нас на зручний спосіб витягти 11 628
 * робочих адрес підприємств по одній.
 */
export class SpotClaims1794300000000 implements MigrationInterface {
  name = 'SpotClaims1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "spot_claims" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "camping_spot_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        -- 8 символів із CSPRNG; sha256 — швидкий хеш доречний, бо
        -- секрет не слабкий. Повільний KDF захищає ПАРОЛІ.
        "code_hash" character(64) NOT NULL,
        -- Лише маска. Повна адреса лишається там, звідки взята.
        "sent_to_masked" character varying(255) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "attempts" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_spot_claims" PRIMARY KEY ("id"),
        CONSTRAINT "FK_spot_claims_spot"
          FOREIGN KEY ("camping_spot_id") REFERENCES "camping_spots"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_spot_claims_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        -- Маска — це маска, а не адреса, і база на цьому наполягає:
        -- рядок із «@» без зірочок означає, що хтось поклав сюди адресу.
        --
        -- 🔴 БЕЗ ЖОДНОГО ЗВОРОТНОГО СКІСНОГО, І ЦЕ НЕ ПРИМХА.
        --
        -- Перша редакція перевіряла маску регулярним виразом з
        -- екранованими зірочками. У базі воно працювало, а
        -- spot-claim.db.spec.ts падав на ПРАВИЛЬНІЙ масці: тест читає
        -- SQL із ТЕКСТУ цього файлу, де подвоєння ще не знято лексером
        -- TypeScript. Тобто «тест виконує те, що справді поїде на
        -- прод» перестає бути правдою рівно там, де є екранування.
        --
        -- LIKE вирішує це без жодного скісного: підкреслення — рівно
        -- один символ, відсоток — будь-що. Маска i***@c***.de
        -- проходить; адреса info@camping.de ні, бо на місці трьох
        -- зірочок стоїть nfo.
        CONSTRAINT "spot_claims_masked_is_masked"
          CHECK (
            "sent_to_masked" LIKE '_***@_***.%'
            AND "sent_to_masked" ~ '[.][a-z]{2,}$'
          ),
        CONSTRAINT "spot_claims_attempts_sane"
          CHECK ("attempts" >= 0 AND "attempts" <= 100)
      )
    `);

    // 🔴 ОДИН ПІДТВЕРДЖЕНИЙ ВЛАСНИК НА КЕМПІНГ, І ЦЕ ТРИМАЄ БАЗА.
    //
    // «Підтверджений» тут — це `used_at IS NOT NULL`: заявка, код якої
    // ввели. Частковий унікальний індекс означає, що другий claim не
    // може стати підтвердженим, навіть якщо два запити прийдуть разом.
    // Перевірка в коді цього не дає: між SELECT і UPDATE встигає все.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_spot_claims_one_owner"
        ON "spot_claims" ("camping_spot_id") WHERE "used_at" IS NOT NULL
    `);

    // Рахунок листів за добу — і на кемпінг, і на акаунт.
    await queryRunner.query(`
      CREATE INDEX "IDX_spot_claims_spot_recent"
        ON "spot_claims" ("camping_spot_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_spot_claims_user_recent"
        ON "spot_claims" ("user_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "spot_claims"`);
  }
}
