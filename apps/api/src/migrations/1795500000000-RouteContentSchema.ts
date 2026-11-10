import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Схема під переїзд маршрутів у CMS — CAMP-479, крок 1 із 2.
 *
 * 🔴 `pages.type` ПЕРЕСТАЄ БУТИ ENUM — І ЦЕ НЕ ОБХІД, А ВИПРАВЛЕННЯ
 * НЕПОСЛІДОВНОСТІ. Поруч, у тій самій моделі, `page_sections.type` уже
 * звичайний `varchar` без CHECK: тип секції оголошений у коді, бо саме
 * код вирішує, що вміє намалювати. Для `pages.type` чомусь завели enum,
 * і тепер кожен новий вид сторінки — це зміна типу бази.
 *
 * Спроба додати значення показала ціну: PostgreSQL забороняє вживати
 * нове значення enum у ТІЙ САМІЙ транзакції, де його додано
 * («unsafe use of new value»), а TypeORM жене всі непримінені міграції
 * однією транзакцією. Тобто навіть розділення на два файли не рятує —
 * заміряно 10.11.2026, міграція впала саме так.
 *
 * `varchar` знімає цей клас проблем назавжди й робить дві половини
 * моделі однаковими. Старий тип не видаляю: видаляльна зміна — рішення
 * власника, а невживаний тип нікому не шкодить.
 *
 * 🔴 `routes.name` СТАЄ НЕОБОВʼЯЗКОВИМ, А НЕ ЗАПОВНЮЄТЬСЯ.
 * Назва маршруту — проза: вона перекладатиметься разом із рештою
 * тексту й живе в `page_translations`. Заповнити тут означало б завести
 * ДРУГЕ джерело правди для назви, і розійшлась би саме та копія, якої
 * ніхто не читає. Колонку не видаляю: видаляльна міграція — рішення
 * власника, а не моє, і порожня колонка нікому не шкодить.
 *
 * 🔴 ЧОМУ ФАКТИ ТУТ, А ПРОЗА В `pages`. Координата етапу — не текст.
 * Поклади її в `jsonb` секції, і редактор зламає геометрію маршруту
 * одруківкою, якої жоден сторож не впіймає: для JSON будь-яке число
 * правильне. У колонці з типом — ні.
 */
export class RouteContentSchema1795500000000 implements MigrationInterface {
  name = 'RouteContentSchema1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 🔴 CHECK ЗНІМАЄТЬСЯ Й ПОВЕРТАЄТЬСЯ, А НЕ ПРОСТО ЗНІМАЄТЬСЯ.
    // `pages_post_published_has_date` порівнює `type` з enum, тож зміна
    // типу колонки валить його («operator does not exist» — заміряно).
    // Сама заборона потрібна: опублікований допис без дати не має права
    // існувати, інакше він або зникне з переліку, або поїде читачеві
    // без дати. Тому обмеження відтворюється дослівно, лише з
    // порівнянням тексту замість enum.
    await queryRunner.query(
      `ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_post_published_has_date`,
    );
    await queryRunner.query(
      `ALTER TABLE pages ALTER COLUMN type TYPE varchar(32) USING type::text`,
    );
    await queryRunner.query(
      `ALTER TABLE pages ADD CONSTRAINT pages_post_published_has_date
         CHECK (type <> 'post' OR status <> 'published' OR published_at IS NOT NULL)`,
    );

    await queryRunner.query(
      `ALTER TABLE routes ALTER COLUMN name DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE routes ALTER COLUMN country DROP NOT NULL`,
    );

    // Країни в порядку, у якому маршрут їх проходить — порядок значущий,
    // тому масив, а не звʼязок із довільним порядком вибірки.
    await queryRunner.query(
      `ALTER TABLE routes ADD COLUMN IF NOT EXISTS countries text[]`,
    );
    // Місяці, коли маршрут справді вартий поїздки (1–12).
    await queryRunner.query(
      `ALTER TABLE routes ADD COLUMN IF NOT EXISTS months smallint[]`,
    );
    // Кому підходить: мітки мандрівника.
    await queryRunner.query(
      `ALTER TABLE routes ADD COLUMN IF NOT EXISTS suits text[]`,
    );
    // Область словами — «Toscana», «Peloponnese». Назва місця, а не
    // проза: на сайті вона показується як є, так само як назви етапів у
    // `route_points.name`, і перекладу не потребує.
    await queryRunner.query(
      `ALTER TABLE routes ADD COLUMN IF NOT EXISTS region text`,
    );
    // Коли людина востаннє пройшла маршрут. Дата звірки, не публікації.
    await queryRunner.query(
      `ALTER TABLE routes ADD COLUMN IF NOT EXISTS curated_at date`,
    );

    // Ночі, які впорядкований маршрут проводить на етапі.
    await queryRunner.query(
      `ALTER TABLE route_points ADD COLUMN IF NOT EXISTS nights integer`,
    );
  }

  /**
   * 🔴 `down` НЕ ПОВЕРТАЄ ENUM, І ЦЕ НАВМИСНО. Повернення типу вимагало б,
   * щоб у колонці не лишилось жодного значення поза старим переліком —
   * тобто відкат мовчки ВИДАЛИВ би сторінки маршрутів. Відкат, який
   * знищує контент, гірший за відкат, що лишає ширшу колонку.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE route_points DROP COLUMN IF EXISTS nights`,
    );
    for (const col of [
      'countries',
      'months',
      'suits',
      'curated_at',
      'region',
    ]) {
      await queryRunner.query(
        `ALTER TABLE routes DROP COLUMN IF EXISTS ${col}`,
      );
    }
  }
}
