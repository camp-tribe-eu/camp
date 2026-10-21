import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-365 — /contact переїжджає з коду в CMS.
 *
 * Друга сторінка після /about. Текст перенесено ДОСЛІВНО; доказ —
 * `apps/web/tests/e2e/contact.spec.ts`, який тримає абзаци рядками й
 * вимагає їх від живої сторінки.
 *
 * 🔴 ПІДСТАНОВКИ, А НЕ ЗНАЧЕННЯ. У тексті стоїть `{{contact.email}}`,
 * `{{company.name}}`, `{{company.city}}`. Попередня версія сторінки
 * брала їх із `lib/legal.ts` — і саме там вони мусять лишитись, інакше
 * зміна адреси стає обходом усіх сторінок (CAMP-188).
 *
 * 🔴 І `type`/`status` ЗАДАНІ ЯВНО. На /about я цього не зробив, і
 * сторінка поїхала читачеві чернеткою — знайшла рецензія PR #302.
 * Поля, від яких залежить видимість, не лишають на замовчування.
 */
export class SeedContactPage1792500000000 implements MigrationInterface {
  name = 'SeedContactPage1792500000000';

  private readonly slug = 'contact';
  private readonly title = 'Contact';
  private readonly metaTitle = 'Contact CampTribe';
  private readonly metaDescription =
    'How to reach {{company.name}}: one address for corrections, licence questions and partnerships.';

  private readonly prose = [
    'One address, read by a person: [{{contact.email}}](mailto:{{contact.email}}). Write to us about a campsite we have wrong, a licence or attribution question, or working together.',
    '**Two things we cannot do.** We do not take bookings and have no part in them: a campsite’s own site or phone is the only place to reserve. And we cannot change what OpenStreetMap says about a place — that map is edited by its own community, and a correction made there reaches us with the next import. Tell us anyway, and we will say which of the two it is.',
    '**If you run a campsite and want your photographs on its page**, send them to the same address. Three things have to come with them: that the picture is yours to give, your permission for us to publish it here, and the month it was taken — we print that date beside every photograph. Uploads through the site do not exist yet, so email is the whole of it.',
    '{{company.name}}, {{company.city}}. Company details and the supervisory authority are on the [legal notice](/legal/notice); what we store and for how long is on the [privacy page](/legal/privacy).',
  ].join('\n\n');

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1`,
      [this.slug],
    );
    if (Number(existing[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), 1, false)
       RETURNING id`,
      [this.slug],
    );
    const pageId = page[0].id;

    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_title, meta_description)
       VALUES ($1, 'en', $2, $3, $4)`,
      [pageId, this.title, this.metaTitle, this.metaDescription],
    );

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

    // 🔴 Адреса кнопки — `mailto:`, не шлях. Рендер секції розрізняє це
    // й малює звичайний якір: `next/link` для схем не призначений, і
    // попередня версія сторінки робила так само.
    const cta: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO page_sections (page_id, sort, type, visible, cta_href)
       VALUES ($1, 1, 'cta', true, 'mailto:{{contact.email}}') RETURNING id`,
      [pageId],
    );
    await queryRunner.query(
      `INSERT INTO page_section_translations (section_id, language_code, cta_label)
       VALUES ($1, 'en', $2)`,
      [cta[0].id, 'Email {{contact.email}}'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Переклади сторінки — явно: FK на `page_translations` додали в уже
    // виконану міграцію, тож на базах, що ганяли її до правки, каскаду
    // немає (заміряно 21.10.2026).
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE slug = $1)`,
      [this.slug],
    );
    await queryRunner.query(`DELETE FROM pages WHERE slug = $1`, [this.slug]);
  }
}
