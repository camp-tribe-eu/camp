import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Головна: «What to drive» перестає бути порожньою коробкою — CAMP-488.
 *
 * 🔴 ЦЕ ДЕФЕКТ, ЯКИЙ ВЛАСНИК НАЗВАВ САМ. На знімку головної 11.11.2026
 * праворуч стоїть картка із заголовком, одним абзацом — і далі порожнеча
 * приблизно на пів-екрана. Заміряно в її розмітці: `<a>` = 0, `<li>` = 0,
 * `<button>` = 0.
 *
 * Причина не в тексті. Секція має тип `prose`, а `Prose` малює лише
 * заголовок і абзац — `items` він ігнорує. Сусідня «Where to stay» виглядає
 * повною лише тому, що під нею окремо малюються плитки країн із даних.
 *
 * 🔴 ТЕКСТ НЕ ЧІПАЄМО, ДОДАЄМО СЕКЦІЮ. Переписати `drive` на `cards`
 * означало б втратити заголовок і абзац: `Cards` їх не малює. Тому проза
 * лишається, а під нею стає друга секція того самого слота — рівно те, що
 * вже зроблено для `/tools`, звідки й узято форму елементів.
 *
 * 🔴 КУДИ ВЕДУТЬ КАРТКИ — ВІДПОВІДЬ НА ТЕ, ЩО ОБІЦЯЄ АБЗАЦ. Він називає
 * три речі: яке посвідчення покриває авто, скільки воно важить
 * спорядженим, і чи влізе воно в кемпінг, куди ви їдете. Кожна картка
 * веде на сторінку, де ця відповідь справді є. Усі три перевірені
 * запитом 11.11.2026 — HTTP 200.
 *
 * 🔴 ЖОДНОГО НОВОГО РЯДКА ТЕКСТУ В КОДІ. Усе це — дані в CMS, і власник
 * може переписати кожне слово в адмінці без розробника. Саме цього він
 * вимагав: «я чи інший адмін має мати можливість міняти все сам».
 */
export class HomeDriveCards1796200000000 implements MigrationInterface {
  name = 'HomeDriveCards1796200000000';

  /** Слот нової секції — щоб її можна було знайти й відкотити. */
  private readonly slot = 'drive-links';

  private readonly items = [
    {
      title: 'Renting a camper in the EU',
      href: '/camper-rental',
      body: 'Which licence covers which vehicle, and what changes the moment it weighs more than 3 500 kg when loaded. Country by country, with the rule we read and the date we read it.',
    },
    {
      title: 'What a camper trip costs',
      href: '/tools/camper-trip-cost',
      body: 'Fuel priced from the European Commission’s weekly bulletin for all 27 member states, against the vehicle you actually drive and what it burns.',
    },
    {
      title: 'Plan the drive',
      href: '/plan',
      body: 'Where a day of driving ends, and which campsites are near that point rather than near the straight line between your two ends.',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 🔴 ШУКАЄМО ЗА СЛАГОМ, А НЕ ЗА ТИПОМ. Заміряно 11.11.2026: головна
    // має `slug = 'home'` і `type = 'page'` — типу `home` в таблиці немає
    // жодного. Перша редакція цієї міграції шукала за типом і впала б на
    // порожній вибірці, тобто «полагодила» б дірку падінням деплою.
    const page = await queryRunner.query(
      `SELECT id FROM pages WHERE slug = 'home' LIMIT 1`,
    );

    // 🔴 ВІДСУТНЯ СТОРІНКА — ПАДІННЯ, А НЕ ТИХИЙ ПРОПУСК. Міграція, що
    // мовчки нічого не зробила, читається як виконана, і дірка на
    // головній лишилась би з позначкою «полагоджено».
    if (page.length === 0) {
      throw new Error(
        "HomeDriveCards: сторінки з type = 'home' немає. " +
          'Секцію нема куди класти, і мовчки пропустити це не можна.',
      );
    }

    const pageId: string = page[0].id;

    // Ідемпотентність: повторний прогін не плодить другу копію.
    const already = await queryRunner.query(
      `SELECT id FROM page_sections WHERE page_id = $1 AND slot = $2`,
      [pageId, this.slot],
    );
    if (already.length > 0) return;

    // Одразу після прозової «drive» (sort 20), але перед «notable» (30).
    const section = await queryRunner.query(
      `INSERT INTO page_sections (page_id, slot, sort, type, visible)
       VALUES ($1, $2, 21, 'cards', true)
       RETURNING id`,
      [pageId, this.slot],
    );

    await queryRunner.query(
      `INSERT INTO page_section_translations (section_id, language_code, items)
       VALUES ($1, 'en', $2::jsonb)`,
      [section[0].id, JSON.stringify(this.items)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM page_section_translations
        WHERE section_id IN (SELECT id FROM page_sections WHERE slot = $1)`,
      [this.slot],
    );
    await queryRunner.query(`DELETE FROM page_sections WHERE slot = $1`, [
      this.slot,
    ]);
  }
}
