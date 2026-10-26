import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Поле `slot`: де секція стоїть, окремо від того, як вона виглядає.
 *
 * 🔴 ЧОМУ НЕ ЧЕРЕЗ `variant` І НЕ ЧЕРЕЗ НОВІ ТИПИ.
 *
 * `variant` уже зайнятий ВИГЛЯДОМ: `page-sections.tsx` вибирає ним стиль
 * із `PROSE_VARIANTS`. Адресувати ним секції означало б змішати «як це
 * виглядає» з «де це стоїть», і наступна зміна стилю пересунула б блок.
 *
 * Нові типи секцій на кожен слот (`stay-intro`, `drive-intro`…) росли б
 * на кожну сторінку й суперечили б методу CAMP-362: «різноманіття
 * кладемо в ПОЛЯ, а не в нові сутності». Поле `slot` — рівно той метод.
 *
 * 🔴 ЩО САМЕ ЦЕ ВИПРАВЛЯЄ. Заміряно 26.10.2026: на головній лишалось
 * ШІСТЬ рядків тексту в коді — три пари «заголовок + підводка» перед
 * динамічними блоками (країни, оренда, помітні кемпінги). Власник просив
 * «все динамічне і не хардкод» (CAMP-365), а ці шість редагувати не міг
 * ніяк. Тексти переносяться ДОСЛІВНО, символ у символ.
 *
 * Колонка nullable: наявні секції слота не мають і не потребують —
 * `hero` і `steps` адресуються типом, бо кожного рівно один.
 */
export class SectionSlot1793100000000 implements MigrationInterface {
  name = 'SectionSlot1793100000000';

  // Три пари, узяті з `app/page.tsx` дослівно.
  private static readonly BLOCKS: ReadonlyArray<
    readonly [slot: string, sort: number, heading: string, body: string]
  > = [
    [
      'stay',
      10,
      'Where to stay',
      'Pick a country to see its regions and campsites.',
    ],
    [
      'drive',
      20,
      'What to drive',
      'Camper rental comparison is not built yet. When it is, it will compare ' +
        'what actually decides a trip — licence category, weight and whether ' +
        'the vehicle fits the campsite — not the price you could already find ' +
        'elsewhere.',
    ],
    [
      'notable',
      30,
      'The campsites we know most about',
      'Ranked by how much has actually been recorded about them, not by any ' +
        'opinion of ours — we have not been to any of them, and there are no ' +
        'reviews on this site.',
    ],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "page_sections" ADD COLUMN IF NOT EXISTS "slot" text`,
    );

    // 🔴 Один слот на сторінку — інакше `sectionBySlot` не знатиме, який
    // брати, і тихо обрав би перший. Нехай база це не дозволяє.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_page_sections_page_slot"
         ON "page_sections" ("page_id", "slot") WHERE "slot" IS NOT NULL`,
    );

    const page = (await queryRunner.query(
      `SELECT id FROM pages WHERE slug = 'home' AND type = 'page' LIMIT 1`,
    )) as Array<{ id: string }>;
    if (page.length === 0) {
      // Міграція сидів головної могла не бігти на цій базі (тестові
      // середовища). Колонка важливіша за рядки; рядки додасть сид.
      return;
    }

    for (const [slot, sort, heading, body] of SectionSlot1793100000000
      .BLOCKS) {
      const row = (await queryRunner.query(
        `INSERT INTO page_sections (page_id, sort, type, variant, visible, slot)
         VALUES ($1, $2, 'prose', NULL, true, $3)
         ON CONFLICT ("page_id", "slot") WHERE "slot" IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [page[0].id, sort, slot],
      )) as Array<{ id: string }>;
      if (row.length === 0) continue;
      await queryRunner.query(
        `INSERT INTO page_section_translations
           (section_id, language_code, heading, body, items)
         VALUES ($1, 'en', $2, $3, $4)`,
        [row[0].id, heading, body, JSON.stringify([])],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM page_section_translations WHERE section_id IN
         (SELECT id FROM page_sections WHERE slot IN ('stay','drive','notable'))`,
    );
    await queryRunner.query(
      `DELETE FROM page_sections WHERE slot IN ('stay','drive','notable')`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_page_sections_page_slot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_sections" DROP COLUMN IF EXISTS "slot"`,
    );
  }
}
