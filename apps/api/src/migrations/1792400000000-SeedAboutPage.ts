import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-365 — /about переїжджає з коду в CMS.
 *
 * 🔴 ЧОМУ САМЕ ЦЯ СТОРІНКА ПЕРШОЮ. Вона найменша з чотирьох, де текст
 * лежить у коді (/about 92 рядки, /contact 95, /tools 183, головна
 * 304), і тому найдешевше доводить ВЕСЬ шлях: база → API → рендер.
 * Поки шлях не доведено на одній, переносити решту означало б
 * множити непідтверджене.
 *
 * 🔴 ТЕКСТ ПЕРЕНЕСЕНО ДОСЛІВНО, і це перевіряється, а не обіцяється:
 * `apps/web/tests/e2e/about.spec.ts` тримає абзаци рядками й вимагає
 * їх від живої сторінки. Еталон знято з попередньої версії компонента
 * перед заміною.
 *
 * 🔴 ПІДСТАНОВКИ ЛИШАЮТЬСЯ ПІДСТАНОВКАМИ. У тексті стоїть
 * `{{company.name}}`, `{{company.city}}` і `{{contact.email}}`, а не
 * «UTD BV, 2000 Antwerpen». Заморозити їх означало б розірвати
 * рішення CAMP-188: адреса компанії мусить лишатись ОДНИМ рядком у
 * `lib/legal.ts`, інакше її зміна стає обходом семи документів.
 * Невідомий ключ у підстановці кидає — див. `lib/rich-text.ts`.
 */
export class SeedAboutPage1792400000000 implements MigrationInterface {
  name = 'SeedAboutPage1792400000000';

  private readonly slug = 'about';
  private readonly title = 'About CampTribe';
  private readonly metaDescription =
    'What CampTribe is, where its campsite data comes from, and — just as plainly — what it does not know.';

  /** Чотири абзаци, дослівно з попереднього `app/about/page.tsx`. */
  private readonly prose = [
    'CampTribe is a directory of campsites, motorhome parks and camper stops across the twenty-seven member states of the European Union. It is built from OpenStreetMap and from official open data published by national and European bodies, and every page says which source a fact came from.',
    '**What we do not know, we say.** Open data is uneven: a campsite may have no recorded opening hours, no price and no answer to whether you may legally spend the night there. Where that is the case the page says so instead of guessing. An empty field is a fact about our data, not a fact about the place.',
    'Alongside the directory we show conditions that change by the hour — official weather warnings, wildfire reports, bathing-water quality and fuel prices — each from the body that issues it, with the time it was issued. Where a reading is older than its source allows, the page says that too rather than showing a stale number as current.',
    'CampTribe is operated by {{company.name}}, {{company.city}}. The legal notice, the licences of every data source and what we do and do not store are set out in full under [Legal notice](/legal/notice).',
  ].join('\n\n');

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 🔴 Ідемпотентно: друга сторінка з тим самим slug дала б читачеві
    // подвоєний текст, а нам — зелений прогін.
    const existing: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1`,
      [this.slug],
    );
    if (Number(existing[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, sort, noindex) VALUES ($1, 0, false) RETURNING id`,
      [this.slug],
    );
    const pageId = page[0].id;

    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_description)
       VALUES ($1, 'en', $2, $3)`,
      [pageId, this.title, this.metaDescription],
    );

    // Секція тексту.
    const prose: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO page_sections (page_id, sort, type, visible)
       VALUES ($1, 0, 'prose', true) RETURNING id`,
      [pageId],
    );
    await queryRunner.query(
      `INSERT INTO page_section_translations (section_id, language_code, body)
       VALUES ($1, 'en', $2)`,
      [prose[0].id, this.prose],
    );

    // Секція заклику. Друга дія — не кнопка, а посилання поруч, як було.
    const cta: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO page_sections (page_id, sort, type, visible, cta_href)
       VALUES ($1, 1, 'cta', true, '/map') RETURNING id`,
      [pageId],
    );
    await queryRunner.query(
      `INSERT INTO page_section_translations (section_id, language_code, cta_label, body)
       VALUES ($1, 'en', $2, $3)`,
      [
        cta[0].id,
        'Open the campsite map',
        '[Or write to us](mailto:{{contact.email}})',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 🔴 ПЕРЕКЛАДИ ПРИБИРАЮТЬСЯ ЯВНО, А НЕ КАСКАДОМ.
    //
    // Каскад на `page_sections` → `page_section_translations` є скрізь:
    // він стоїть у CREATE TABLE з першого дня. А `FK_page_translations
    // _page` ДОДАЛИ в ту саму міграцію ПІСЛЯ того, як вона десь уже
    // прогналась, — і TypeORM такі бази не доганяє. Заміряно 21.10.2026:
    //   camptribe_dev     page_translations FK: 1
    //   camptribe_nav365  page_translations FK: 1
    //   camptribe_cms362  page_translations FK: 0   ← ганяла до правки
    //
    // Отже спиратись тут на каскад означало б лишити сиріт саме на тих
    // базах, де схема відстала, і не дізнатись про це ніколи.
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE slug = $1)`,
      [this.slug],
    );
    await queryRunner.query(`DELETE FROM pages WHERE slug = $1`, [this.slug]);
  }
}
