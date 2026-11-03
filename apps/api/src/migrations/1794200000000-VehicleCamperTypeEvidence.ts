import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-371, пункт 3: тип кемпера має прийти в базу РАЗОМ зі своїм доказом.
 *
 * `camper_type_id` у `rental_provider_vehicles` існує з CAMP-427 і стояв
 * порожнім у 39 із 39 машин. Заповнити його мало — поруч мусить лежати
 * те, чим він доведений.
 *
 * 🔴 ДВІ КОЛОНКИ, І КОЖНА ЗАКРИВАЄ ОКРЕМУ БРЕХНЮ.
 *
 * `camper_type_said` — ДОСЛІВНІ слова самого прокатника («Car type:
 * Semi-integrated», «Agile overcab motorhome», «полуинтегриран»). Без них
 * тип — це НАШ висновок, виданий за його. Саме так народжується «у них є
 * Hymer B-Class», якого ніхто не бачив.
 *
 * `camper_type_checked_on` — ОКРЕМА дата зрізу, і це не прискіпливість.
 * Парк і характеристики прочитані 02.11.2026, типи — 03.11 по 70
 * сторінках. Показати тип із датою 02.11 означало б поставити під фактом
 * день, коли його не читали. Умова картки дослівна: «кожен запис несе
 * дату прочитання, і вона показана читачеві» — запис, не сусідній запис.
 *
 * Обидві колонки nullable: у 85 машин зі 115 типу немає, і порожнє поле
 * чесніше за тип, виведений із довжини.
 */
export class VehicleCamperTypeEvidence1794200000000 implements MigrationInterface {
  name = 'VehicleCamperTypeEvidence1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rental_provider_vehicles"
        ADD COLUMN "camper_type_said" character varying,
        ADD COLUMN "camper_type_checked_on" date
    `);
    // 🔴 СПЕРШУ ПРИБИРАЄМО ТЕ, ЩО ОБМЕЖЕННЯ ОГОЛОШУЄ ПОЗА ЗАКОНОМ.
    //
    // Рядок, що вже має `camper_type_id`, не може мати доказу: колонок для
    // нього мить тому не існувало. Тобто це рівно той дефект, який ми й
    // забороняємо — тип, за яким не стоїть нічого.
    //
    // Заміряно: на проді таких рядків НУЛЬ, бо `camper_types` порожня і
    // зовнішньому ключу нікуди вказувати. Але спиратись на «у нас зараз
    // порожньо» — це не підстава, а везіння, тож міграція каже вголос,
    // скільки прибрала. Сівалка поверне їх уже з доказом.
    // 🔴 РАХУЄМО ОКРЕМИМ SELECT, А НЕ ПО ВИВОДУ UPDATE.
    //
    // Перша редакція брала `(await query('UPDATE … RETURNING 1')).length` —
    // і друкувала **2** там, де рядків було **30**. TypeORM віддає на
    // UPDATE пару `[рядки, кількість]`, тож довжина зовнішнього масиву це
    // завжди 2. Число виглядало як замір і ним не було.
    const [{ count }] = (await queryRunner.query(`
      SELECT count(*)::int AS count FROM "rental_provider_vehicles"
       WHERE "camper_type_id" IS NOT NULL
    `)) as { count: number }[];
    if (count > 0) {
      await queryRunner.query(`
        UPDATE "rental_provider_vehicles" SET "camper_type_id" = NULL
         WHERE "camper_type_id" IS NOT NULL
      `);
      console.log(
        `VehicleCamperTypeEvidence: знято тип у ${count} машин — ` +
          'він стояв без доказу; запусти scripts/rental/seed-camper-types.mjs',
      );
    }

    // 🔴 Тип без доказу не має сенсу, і навпаки — доказ без типу теж.
    // Обмеження тримає це разом, щоб наступна сівалка не поклала
    // половину: саме «половина правди» й виглядає на сторінці як повна.
    await queryRunner.query(`
      ALTER TABLE "rental_provider_vehicles"
        ADD CONSTRAINT "rental_provider_vehicles_type_has_evidence"
        CHECK (
          ("camper_type_id" IS NULL
             AND "camper_type_said" IS NULL
             AND "camper_type_checked_on" IS NULL)
          OR ("camper_type_id" IS NOT NULL
             AND "camper_type_said" IS NOT NULL
             AND "camper_type_checked_on" IS NOT NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rental_provider_vehicles"
        DROP CONSTRAINT "rental_provider_vehicles_type_has_evidence"
    `);
    await queryRunner.query(`
      ALTER TABLE "rental_provider_vehicles"
        DROP COLUMN "camper_type_checked_on",
        DROP COLUMN "camper_type_said"
    `);
  }
}
