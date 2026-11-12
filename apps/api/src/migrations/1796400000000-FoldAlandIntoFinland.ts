import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-490: Åland — не окрема країна. 19 кемпінгів `AX` стають `FI`.
 *
 * Рішення власника — у назві картки: «Åland не окрема країна». Область
 * проєкту — ЄС-27, Åland — автономний регіон Фінляндії. Імпорт уже зводить
 * `ax` до `fi` (`osm/eu.ts`), але рядки, імпортовані до цього, лишились
 * із `AX`: заміряно на `camptribe_dev` — 19, усі з регіоном, жоден slug не
 * збігається з жодним у `FI` (slug глобально унікальний).
 *
 * Кемпінги не зникають, а переїжджають: `/camping/ax/…` → `/camping/fi/…`
 * веде 301 у `middleware.ts` (`moveCountry`).
 *
 * Інші таблиці з колонкою `country` рядків `ax` не мають (заміряно: 0).
 * `down` відновлює рівно ці 19 за slug (глобально унікальний) зі списку
 * нижче: «це були AX станом на 12.11.2026» (`camptribe_dev`, 19 рядків).
 * Рядок, якого імпорт з того часу додав або прибрав, у список не входить.
 */
const WERE_AX_ON_2026_11_12 = [
  'alands-caravan-club',
  'bike-bed',
  'bjorklidens-stugby',
  'degersand',
  'eckero-camping-stugor',
  'grona-uddens-camping',
  'hummelvik-camping',
  'karingsund',
  'karingsund-resort-conference-camping',
  'karingsunds-camping',
  'kattnas-camping',
  'majlidens-stallplats',
  'notvikens-stugor-camping',
  'overnasgarden',
  'sandosunds-camping',
  'sandvik',
  'spot-a3094674728',
  'spot-n11061645944',
  'svino-stugby',
];

export class FoldAlandIntoFinland1796400000000 implements MigrationInterface {
  name = 'FoldAlandIntoFinland1796400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE camping_spots SET country = 'FI' WHERE lower(country) = 'ax'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE camping_spots SET country = 'AX' WHERE slug = ANY($1)`,
      [WERE_AX_ON_2026_11_12],
    );
  }
}
