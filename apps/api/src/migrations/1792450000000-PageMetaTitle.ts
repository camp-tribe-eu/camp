import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-365 — окремий заголовок для пошуковика.
 *
 * 🔴 НАВІЩО ОКРЕМЕ ПОЛЕ, А НЕ «ХАЙ БУДЕ ОДИН ЗАГОЛОВОК».
 *
 * Заголовок НА сторінці й заголовок ДЛЯ пошуковика збігаються не
 * завжди. Заміряно на /contact перед переїздом: `<h1>` каже «Contact»,
 * а `metadata.title` — «Contact CampTribe». Одне поле змусило б
 * вибрати, і будь-який вибір був би мовчазною зміною SEO всередині
 * переносу тексту.
 *
 * Поле НЕОБОВʼЯЗКОВЕ: коли порожнє, береться `title`. Тобто /about, де
 * обидва збігаються, лишається як є, і міграція нічого не змінює на
 * вже перенесених сторінках.
 */
export class PageMetaTitle1792450000000 implements MigrationInterface {
  name = 'PageMetaTitle1792450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "page_translations" ADD COLUMN IF NOT EXISTS "meta_title" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "page_translations" DROP COLUMN IF EXISTS "meta_title"`,
    );
  }
}
