import { MigrationInterface, QueryRunner } from 'typeorm';
import { AttributionElevationFromBucket1796000000000 } from './1796000000000-AttributionElevationFromBucket';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Сторінка «Data and attribution» 1.3 → 1.4: декоративні банери, згенеровані
 * ШІ (CAMP-469).
 *
 * 🔴 ЧОМУ ЦЕ СТОРІНКА, А НЕ ВИНЯТОК У ТЕСТІ. Скрипт, що генерує банери,
 * ходить на `fal.run`; сторож атрибуції побачив новий зовнішній хост у коді
 * без рядка на сторінці. Приховати його в `NOT_A_SOURCE` означало б мовчки
 * обійти правило, яке ми самі поставили. Те саме речення вже стоїть у
 * `llms.txt`: банери згенеровані й не зображують жодного реального місця.
 * Сказати, ЧИМ саме, — завершення тієї ж думки. Модель названо, бо
 * «згенеровано ШІ» без назви — твердження, яке нічим не перевірити.
 *
 * Розділ стоїть перед «Typefaces», як і «Flags»: обидва про те, ЧИМ
 * намальовано сторінку, а не про дані на ній.
 *
 * 🔴 ТЕКСТ НЕ ОБІЦЯЄ БІЛЬШЕ, НІЖ ЗНАЄМО. Ми кажемо, що зображення створене з
 * текстового запиту без чужого вихідного знімка (так і було: скрипт
 * `scripts/images/generate-banners.mjs` не передає жодного зображення) і що
 * запит і seed кожного збережено. Про права на вихід не пишемо нічого
 * понад це: умови сервісу — їхні, і ми їх не переказуємо з пам'яті.
 */
export class AttributionBannerImages1796600000000 implements MigrationInterface {
  name = 'AttributionBannerImages1796600000000';

  /** Те, що 1.3 поклала в базу — береться з її міграції, не передруковується. */
  readonly previous = new AttributionElevationFromBucket1796000000000().page;

  readonly page = (() => {
    const body = replaceOnce(
      this.previous.body,
      '## Typefaces {#type}',
      `## Decorative images {#images}

The banners behind page headings and on the section cards are AI-generated. They were made with the FLUX1.1 [pro] ultra model from Black Forest Labs, run through the hosted service at [fal.run](https://fal.run/fal-ai/flux-pro/v1.1-ultra), from a text prompt alone: no photograph or other picture was supplied. We keep the prompt and the seed of every image on record.

They show no real place. A tent, a road, a night sky: none is a photograph of any campsite, region or country, and none should be read as one.

## Typefaces {#type}`,
    );
    return {
      // Літерал, а не `this.previous.slug`: сторож реєстру шукає останню
      // міграцію документа за `slug: '…'` у тексті файла.
      slug: 'attribution',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.4',
      effectiveFrom: '2026-11-11',
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
