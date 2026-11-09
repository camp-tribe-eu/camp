import { MigrationInterface, QueryRunner } from 'typeorm';
import { AttributionSources1793700000000 } from './1793700000000-AttributionSources';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Сторінка «Data and attribution» 1.1 → 1.2: прапори країн (CAMP-450).
 *
 * 🔴 ЧОМУ ЦЕ ЛІЦЕНЗІЯ, А НЕ РЕДАКТУРА. /camping показує прапор кожної з
 * 27 країн — SVG-файли з flag-icons (Panayiotis Lipiridis), які ми
 * поклали до себе в `apps/web/public/flags/`. Ліцензія MIT (прочитана з
 * `LICENSE` репозиторію lipis/flag-icons 08.11.2026, Copyright (c) 2013
 * Panayiotis Lipiridis) дозволяє це ЗА УМОВИ, що повідомлення про
 * авторські права супроводжує копії. Копія повідомлення лежить поруч із
 * 🔴 РІШЕННЯ ВЛАСНИКА 08.11.2026: повідомлення про автора живе ЛИШЕ тут,
 * а не файлом біля самих прапорів. Його слова: «ну навіщо поруч з
 * прапорами? ну буде огидно… краще мати сторінку ліц де ми будемо як
 * свалку мати всі авторські права показані». Тобто одне місце на весь
 * проєкт, куди звіряються всі чужі права. Цей розділ — те саме для читача,
 * там, де названо решту чужого на сайті. Сторінка обіцяє назвати
 * «exactly what, from whom, and under which licence» — прапори без рядка
 * тут робили б обіцянку неправдою.
 *
 * Розділ стоїть перед «Typefaces»: обидва — про те, ЧИМ намальовано
 * сторінку, а не про дані на ній.
 *
 * 🔴 ТА САМА ДИСЦИПЛІНА, ЩО В ПРИВАТНОСТІ 2.1–2.4: текст живе в базі
 * (CAMP-365), версію підіймає міграція разом із реєстром `lib/legal.ts`;
 * `applyLegalUpdate` — три випадки: 1.1 → оновити, 1.2 → нічого, інше →
 * падіння з назвою. `pages/legal-seeded.ts` накладає це тіло на посів для
 * тестів; `tests/unit/attribution-sources.spec.ts` звіряє хости.
 */
export class AttributionFlags1794800000000 implements MigrationInterface {
  name = 'AttributionFlags1794800000000';

  /** Те, що 1.1 поклала в базу — береться з її міграції, не передруковується. */
  readonly previous = new AttributionSources1793700000000().page;

  readonly page = (() => {
    const body = replaceOnce(
      this.previous.body,
      '## Typefaces {#type}',
      `## Flags {#flags}

The country flags on the [camping index](/camping) are the SVG files of [flag-icons](https://flagicons.lipis.dev/) by Panayiotis Lipiridis, released under the [MIT License](https://opensource.org/license/mit) — Copyright (c) 2013 Panayiotis Lipiridis — and served from our own domain. This page is where that notice lives: we keep every third-party right in one place rather than scattering licence files beside the assets.

## Typefaces {#type}`,
    );
    return {
      // Літерал, а не `this.previous.slug`: сторож реєстру шукає останню
      // міграцію документа за `slug: '…'` у тексті файла.
      slug: 'attribution',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.2',
      effectiveFrom: '2026-11-08',
      body,
    };
  })();

  public async up(queryRunner: QueryRunner): Promise<void> {
    await applyLegalUpdate(queryRunner, this.page, this.previous);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await revertLegalUpdate(queryRunner, this.page, this.previous);
  }
}
