import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `/contact` не було в жодному меню — сторінка працювала і не знаходилась.
 *
 * 🔴 ЗНАЙШОВ ВЛАСНИК 26.10.2026, відкривши сайт: «contact немає в меню
 * хедера». Заміряно після: сторінка віддає 200, а в меню шапки її немає,
 * у підвалі — лише сім правових посилань із коду, і єдине посилання на
 * неї в усьому сайті — кнопка на картці кемпінгу.
 *
 * Той самий клас, що й CAMP-280: готовий розділ, недосяжний для читача
 * й для пошуку.
 *
 * 🔴 ЧОМУ В ПІДВАЛ, А НЕ В ШАПКУ. У шапці вже десять пунктів, і без JS
 * вони малюються одним рядом (CAMP-383 показала, що там легко вилізти за
 * екран). «Контакти» — те, що шукають у підвалі, а не в головній
 * навігації. Розділ `footer` для цього вже існував у схемі й нічого не
 * малював — тепер малює (CAMP-397).
 *
 * 🔴 ПІДПИС ЙДЕ В `navigation_translations`, бо в самій `navigation`
 * колонки з підписом НЕМАЄ. Я на цьому вже спіткнувся, коли реєстрував
 * колекції в CMS: без перекладу пункт був би без назви.
 */
export class ContactInFooter1793200000000 implements MigrationInterface {
  name = 'ContactInFooter1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = (await queryRunner.query(
      `SELECT id FROM navigation WHERE href = '/contact' AND location = 'footer' LIMIT 1`,
    )) as Array<{ id: string }>;
    if (existing.length > 0) return;

    const row = (await queryRunner.query(
      `INSERT INTO navigation (location, sort, href, visible)
       VALUES ('footer', 10, '/contact', true) RETURNING id`,
    )) as Array<{ id: string }>;

    await queryRunner.query(
      `INSERT INTO navigation_translations (navigation_id, language_code, label)
       VALUES ($1, 'en', 'Contact')`,
      [row[0].id],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM navigation_translations WHERE navigation_id IN
         (SELECT id FROM navigation WHERE href = '/contact' AND location = 'footer')`,
    );
    await queryRunner.query(
      `DELETE FROM navigation WHERE href = '/contact' AND location = 'footer'`,
    );
  }
}
