import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-433 / CAMP-338: чотирнадцять колонок `timestamp without time zone`
 * стають `timestamptz`.
 *
 * 🔴 ЧОМУ ЦЕ БУЛО НЕПРАВДОЮ, А НЕ НЕОХАЙНІСТЮ. Наївна колонка зберігає
 * МІСЦЕВИЙ час тієї машини, що писала рядок. Заміряно 16.10.2026: той
 * самий архів вивантаження ніс `15:41:06.060` (без зони) і
 * `13:41:06.068Z` для ОДНІЄЇ події — різниця рівно дві години, бо
 * ноутбук у CEST, а сервер в UTC.
 *
 * 🔴 ЧОМУ `AT TIME ZONE 'UTC'` БЕЗПЕЧНЕ ТУТ, І ЦЕ ЗАМІР, А НЕ ВІРА.
 *
 * Питання «а чи писали ці рядки з двох різних машин» вирішує, можна
 * взагалі конвертувати чи ні. Заміряно на проді 03.11.2026:
 *
 *   timedatectl  →  Etc/UTC
 *   SHOW timezone →  Etc/UTC
 *   users                9 рядків, 2026-10-16 17:10 … 23:17
 *   trips                0
 *   reviews              0
 *   photo_submissions    0
 *   camping_spots   63 260, найсвіжіший 2026-11-03 04:34:59 — нічний імпорт
 *
 * Три таблиці з даними людей ПОРОЖНІ. Рядки `users` писав API на машині,
 * що стоїть в UTC. `camping_spots` пише той самий API і таймер на тій
 * самій машині. А з PR #437 пояс сесії прибитий до UTC в обох пулах
 * (`options: '-c timezone=UTC'`), тож навіть запуск із ноутбука писав би
 * UTC. Отже наявні значення — UTC, і `AT TIME ZONE 'UTC'` читає їх як є,
 * нічого не зсуваючи.
 *
 * 🔴 ЯКБИ ХОЧ ОДНА З ТРЬОХ ТАБЛИЦЬ БУЛА НЕПОРОЖНЯ, цієї міграції тут не
 * було б: відрізнити запис із ноутбука від запису з сервера постфактум
 * неможливо, і конвертувати наосліп означало б зсунути частину рядків на
 * дві години назавжди.
 */
export class NaiveTimestampsToUtc1794500000000 implements MigrationInterface {
  name = 'NaiveTimestampsToUtc1794500000000';

  /**
   * Рівно ті колонки, які `information_schema` назвала наївними на проді
   * 03.11.2026. Перелік явний, а не запит «усі наївні»: міграція, що
   * сама вирішує, що їй чіпати, змінює різне на різних базах.
   */
  static readonly COLUMNS: ReadonlyArray<readonly [string, string]> = [
    ['camping_spots', 'created_at'],
    ['guides', 'created_at'],
    ['guides', 'updated_at'],
    ['legal_pages', 'updated_at'],
    ['pages', 'created_at'],
    ['pages', 'updated_at'],
    ['photo_submissions', 'created_at'],
    ['rental_cities', 'updated_at'],
    ['rental_providers', 'updated_at'],
    ['reviews', 'created_at'],
    ['routes', 'created_at'],
    ['site_settings', 'updated_at'],
    ['trips', 'created_at'],
    ['users', 'created_at'],
  ];

  /**
   * 🔴 СКІЛЬКИ ЦЕ ТРИМАЄ ЗАМОК — ЗАМІРЯНО, А НЕ ПРИКИНУТО.
   *
   * `ALTER COLUMN … TYPE` переписує таблицю під `ACCESS EXCLUSIVE`: поки
   * він іде, таблиця недоступна навіть на читання. Найбільша тут —
   * `camping_spots`, і саме її варто було зміряти, перш ніж вести це на
   * прод.
   *
   * Заміряно на `camptribe_dev` 03.11.2026 (63 159 рядків, 373 МБ, та
   * сама схема, що на проді):
   *
   *   BEGIN; ALTER … ; ROLLBACK;   →  1,9 с
   *
   * Решта тринадцять колонок — у таблицях на порядки менших. Тобто вся
   * міграція це секунди замка, а не хвилини, і вона йде однією
   * транзакцією разом із рештою: `camptribe-deploy --migrate` робить
   * знімок бази перед нею й не перемикає `current`, якщо щось не
   * прийнялось.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of NaiveTimestampsToUtc1794500000000.COLUMNS) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ALTER COLUMN "${column}" TYPE TIMESTAMP WITH TIME ZONE
          USING "${column}" AT TIME ZONE 'UTC'
      `);
    }
    // 🔴 ДОВОДИМО РЕЗУЛЬТАТ, А НЕ ПРИПУСКАЄМО ЙОГО. Міграція, що
    // відпрацювала без помилки, і міграція, що досягла мети, — різні
    // твердження: одна пропущена колонка не кидає винятку, вона просто
    // лишається наївною й чекає наступного вивантаження даних людини.
    const left = (await queryRunner.query(`
      SELECT table_name || '.' || column_name AS col
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type = 'timestamp without time zone'
       ORDER BY 1
    `)) as { col: string }[];
    if (left.length > 0) {
      throw new Error(
        `лишилось ${left.length} наївних колонок: ${left.map((r) => r.col).join(', ')}`,
      );
    }
  }

  /**
   * 🔴 ВІДКІТ ПОВЕРТАЄ ТИП І ВТРАЧАЄ ЗОНУ — і це сказано тут, бо з
   * `timestamptz` у `timestamp` без зони інакше не буває. Значення
   * читаються через пояс сесії, а він прибитий до UTC (`db-session.ts`),
   * тож відкіт поверне ті самі числа, що були до `up()`.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of NaiveTimestampsToUtc1794500000000.COLUMNS) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ALTER COLUMN "${column}" TYPE TIMESTAMP WITHOUT TIME ZONE
          USING "${column}" AT TIME ZONE 'UTC'
      `);
    }
  }
}
