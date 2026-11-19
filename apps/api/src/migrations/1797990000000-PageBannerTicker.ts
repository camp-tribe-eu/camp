import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Слово на бігучому рядку банера — у CMS (CAMP-478, пункт 3).
 *
 * Шість сторінок (`/tools`, `/contact`, `/about`, `/guides`, `/routes`,
 * `/camping/winter`) брали заголовок і опис банера з бази, а слово на
 * бігучому рядку («PLANNING», «WRITE TO US»…) було літералом у коді
 * сторінки. Власник міг змінити все на банері, крім найбільшого напису.
 *
 * Колонка в `page_translations`, а не секція: секцію з невідомим типом
 * `PageSections` на /about, /routes і /contact намалювала б чи сховала, а
 * слово — властивість сторінки, як `title`. Таблиць нуль, слот Directus
 * не витрачається (межа 25 рахує колекції, а не поля).
 *
 * 🔴 Текст ДОСЛІВНО той, що стояв у коді на 19.11.2026: переїзд, який
 * заразом міняє слово, неможливо перевірити. Порожньо — сторінка бере
 * заголовок великими літерами, а не літерал у коді.
 */
export class PageBannerTicker1797990000000 implements MigrationInterface {
  name = 'PageBannerTicker1797990000000';

  static readonly TICKERS: ReadonlyArray<readonly [slug: string, ticker: string]> = [
    ['tools', 'PLANNING'],
    ['contact', 'WRITE TO US'],
    ['about', 'CAMPTRIBE'],
    ['guides', 'GUIDES'],
    ['routes', 'ROUTES'],
    ['winter', 'WINTER'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE page_translations ADD COLUMN IF NOT EXISTS banner_ticker text`,
    );
    for (const [slug, ticker] of PageBannerTicker1797990000000.TICKERS) {
      // Лише порожнє: повторний прогін не затре слово, яке власник уже змінив.
      await queryRunner.query(
        `UPDATE page_translations t SET banner_ticker = $2
           FROM pages p
          WHERE p.id = t.page_id AND p.slug = $1 AND p.type = 'page'
            AND t.language_code = 'en'
            AND coalesce(t.banner_ticker, '') = ''`,
        [slug, ticker],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE page_translations DROP COLUMN IF EXISTS banner_ticker`,
    );
  }
}
