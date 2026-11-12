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
 * `down` нічого не робить: після `up` не відрізнити колишні `AX` від
 * решти `FI`, а повернути код, якого імпорт більше не видає, не можна.
 */
export class FoldAlandIntoFinland1796400000000 implements MigrationInterface {
  name = 'FoldAlandIntoFinland1796400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE camping_spots SET country = 'FI' WHERE lower(country) = 'ax'`,
    );
  }

  public async down(): Promise<void> {
    // Незворотна за побудовою — див. коментар вище.
  }
}
