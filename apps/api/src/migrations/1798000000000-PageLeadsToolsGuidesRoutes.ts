import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Описи сторінок /tools, /guides і /routes — переписано (CAMP-478).
 *
 * `meta_description` на цих сторінках — це ОДНОЧАСНО опис під заголовком
 * банера і рядок під посиланням у пошуку. Тому він мусить читатися як
 * людська фраза, а не як технічна документація: «Ordered sets of stops…»
 * був правдою, але так ніхто не говорить.
 *
 * /tools до того ж брав опис банера літералом із коду, окремим від цього
 * поля; тепер банер читає поле, як решта сторінок, і власник править одне.
 *
 * Правило власника 19.11.2026: контент — продакшн. Кожен текст:
 * перше речення каже, що тут є; ключові слова стоять природно; ~150 знаків;
 * і 🔴 жодного слова про те, чого немає за сторінкою (ціни пального — із
 * тижневого бюлетеня Єврокомісії; кемпінги біля етапів — ті, що є в базі;
 * лічильники в гідах — справжні).
 *
 * Лише якщо в полі досі старий текст: правку власника не затираємо.
 */
const TEXTS: ReadonlyArray<readonly [slug: string, old: string, next: string]> =
  [
    [
      'tools',
      'Free tools for planning a camper trip: what it costs with this week’s real EU fuel prices, and what to pack.',
      'Two free camper trip tools: price the drive with this week’s EU fuel prices from the European Commission, and build a packing list around how you travel.',
    ],
    [
      'guides',
      'Each guide answers one question about one region, using counts from our own records — including how many campsites have nothing recorded.',
      'Camping guides to EU regions, each answering one question a traveller asks, with real counts from our campsite records and an honest note of what is missing.',
    ],
    [
      'routes',
      'Ordered sets of stops through the European Union, each with the campsites our database actually holds near every stage.',
      'Camper routes through the European Union, stage by stage, with the campsites we know near every stop, so you can see where each night could be before you leave.',
    ],
  ];

export class PageLeadsToolsGuidesRoutes1798000000000 implements MigrationInterface {
  name = 'PageLeadsToolsGuidesRoutes1798000000000';

  private async swap(q: QueryRunner, slug: string, from: string, to: string) {
    await q.query(
      `UPDATE page_translations t SET meta_description = $3
         FROM pages p
        WHERE p.id = t.page_id AND p.slug = $1 AND p.type = 'page'
          AND t.language_code = 'en'
          AND (t.meta_description = $2 OR coalesce(t.meta_description, '') = '')`,
      [slug, from, to],
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [slug, old, next] of TEXTS)
      await this.swap(queryRunner, slug, old, next);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [slug, old, next] of TEXTS) {
      await queryRunner.query(
        `UPDATE page_translations t SET meta_description = $2
           FROM pages p
          WHERE p.id = t.page_id AND p.slug = $1 AND p.type = 'page'
            AND t.language_code = 'en' AND t.meta_description = $3`,
        [slug, old, next],
      );
    }
  }
}
