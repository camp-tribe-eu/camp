import { MigrationInterface, QueryRunner } from 'typeorm';
import { SectionSlot1793100000000 } from './1793100000000-SectionSlot';

/**
 * CAMP-463: підводка «What to drive» на головній переставала бути
 * дорожньою картою.
 *
 * 🔴 ЩО ТАМ СТОЯЛО, І ЧОМУ ЦЕ ЗНАЙШЛОСЬ ТІЛЬКИ ЗАРАЗ. Текст:
 *
 *   «Camper rental comparison is not built yet. When it is, it will
 *    compare what actually decides a trip — licence category, weight and
 *    whether the vehicle fits the campsite — not the price you could
 *    already find elsewhere.»
 *
 * Тобто на ГОЛОВНІЙ сторінці читачеві повідомлялось, чого ми ще не
 * побудували і що збираємось зробити потім. Греп по `apps/web/src` цього
 * не бачив: рядок засіяний у `page_sections` міграцією
 * `SectionSlot1793100000000`. Його знайшов сторож
 * `check-no-internal-kitchen.mjs`, який читає ЗІБРАНІ сторінки, —
 * власне заради такого випадку він і читає їх, а не код.
 *
 * 🔴 ЩО ЛИШИЛОСЬ ІЗ СТАРОГО ТЕКСТУ — усе, що було про читача: ліцензія,
 * вага, чи влізе машина в кемпінг. Пішло лише те, що було про нас:
 * «не побудовано», «коли буде», «потім». Обіцянка з датою, якої ми не
 * знаємо, — те саме правило, що в `route-figures.tsx`.
 *
 * 🔴 ОНОВЛЕННЯ ЗА `slot`, А НЕ ЗА ТЕКСТОМ. Шукати рядок за його ж
 * вмістом означало б, що міграція мовчки нічого не зробить, якщо текст
 * до неї вже хтось правив у CMS. `slot = 'drive'` — це адреса блока, і
 * вона не залежить від слів усередині.
 */
export class DriveSlotNoRoadmap1795000000000 implements MigrationInterface {
  name = 'DriveSlotNoRoadmap1795000000000';

  /** Те, що засіяв `SectionSlot` — береться з його ж міграції, не з памʼяті. */
  static readonly PREVIOUS = SectionSlot1793100000000.BLOCKS.find(
    ([slot]) => slot === 'drive',
  )!;

  static readonly BODY =
    'What decides a trip is not the price: which licence covers the ' +
    'vehicle, what it is allowed to weigh once loaded, and whether it fits ' +
    'the campsite you are heading for.';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE page_section_translations t
          SET body = $1
         FROM page_sections s
        WHERE s.id = t.section_id
          AND s.slot = 'drive'
          AND t.language_code = 'en'`,
      [DriveSlotNoRoadmap1795000000000.BODY],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE page_section_translations t
          SET body = $1
         FROM page_sections s
        WHERE s.id = t.section_id
          AND s.slot = 'drive'
          AND t.language_code = 'en'`,
      [DriveSlotNoRoadmap1795000000000.PREVIOUS[3]],
    );
  }
}
