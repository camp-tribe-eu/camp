import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * П'ять текстів секцій — переписано для читача (CAMP-478, правило власника
 * 19.11.2026: «контент — продакшн, а не риба»).
 *
 * Що було не так: вступи /guides і /routes читались як документація
 * («an ordered set of stops», «written to be argued with», «our database
 * actually holds»), а три рядки головної казали, ЩО натиснути, але не НАВІЩО.
 *
 * 🔴 Кожне нове речення стоїть на тому, що є за сторінкою:
 *  - теми гідів — рівно ті пʼять, що в `lib/guide-facets.ts` TOPICS
 *    (near water, motorhomes, dogs, step-free, officially classified);
 *  - «озеро, місто, станція» — те, що показує сторінка регіону (слайд 1);
 *  - кількість маршрутів НЕ названа: це дані CMS, і число в тексті
 *    збрехало б після першого нового маршруту.
 *
 * Замінюється лише старий текст дослівно: правку власника не затираємо.
 */
const TEXTS: ReadonlyArray<
  readonly [slug: string, where: string, old: string, next: string]
> = [
  [
    'home',
    'stay',
    'Pick a country to see its regions and campsites.',
    'Choose a country, then a region, and every campsite in it is listed with the lake, town and railway stop nearest to it.',
  ],
  [
    'home',
    'feature-map',
    'Pan and zoom across the EU, or browse by country.',
    'Every campsite and motorhome park we know in the EU on a single map. Zoom into a coast or a valley and see what is there before you pick a country.',
  ],
  [
    'home',
    'feature-guides',
    'What the campsite data says about a region: what is there, and what is near it.',
    'Short guides to EU regions, each answering one practical question from our campsite records — gaps included.',
  ],
  [
    'guides',
    '',
    'Each of these answers one question about one region, using counts from our own records. They say how many campsites have something recorded — and how many have nothing, which is usually the larger number and the reason to trust the rest.',
    'Each guide takes one region and one question travellers actually ask: which campsites are near water, which welcome dogs, which suit a motorhome, which are step-free, which are officially classified. The answer comes from our own campsite records, and every guide also says how many campsites have nothing recorded — usually the larger number, and the reason you can trust the rest.',
  ],
  [
    'routes',
    '',
    'Routes through the European Union, each one an ordered set of stops with the campsites our database actually holds near every stage. They are written to be argued with: each says what it is for, when it works, what the driving is like, and who it does not suit.',
    'Camper routes through the European Union, stage by stage, with the campsites we know near every stop. Each one says what it is for, when it works best, what the driving is like and who it does not suit — so you can rule a route out as quickly as you choose one.',
  ],
];

export class ReaderFacingSectionTexts1798010000000 implements MigrationInterface {
  name = 'ReaderFacingSectionTexts1798010000000';

  private async swap(
    q: QueryRunner,
    slug: string,
    slot: string,
    from: string,
    to: string,
  ) {
    await q.query(
      `UPDATE page_section_translations st SET body = $4
         FROM page_sections s, pages p
        WHERE st.section_id = s.id AND s.page_id = p.id
          AND p.slug = $1 AND p.type = 'page'
          AND coalesce(s.slot, '') = $2
          AND st.language_code = 'en' AND st.body = $3`,
      [slug, slot, from, to],
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [slug, slot, old, next] of TEXTS)
      await this.swap(queryRunner, slug, slot, old, next);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [slug, slot, old, next] of TEXTS)
      await this.swap(queryRunner, slug, slot, next, old);
  }
}
