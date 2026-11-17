import { MigrationInterface, QueryRunner } from 'typeorm';
import { AttributionWeatherForecast1797930000000 } from './1797930000000-AttributionWeatherForecast';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * «Data and attribution» 1.5 → 1.6: згенеровані фото сторінок країн,
 * маршрутів, оренди й тем гайдів (рішення власника 17.11.2026).
 *
 * 🔴 ЩО САМЕ СТВЕРДЖУЄ ТЕКСТ — і кожне з цього тримає код:
 * - згенеровано Seedream 5.5 через fal.run, з текстового запиту, без
 *   вихідного знімка (`scripts/page-photos/` не передає зображення);
 *   seed ця модель не повертає, тож обіцяємо лише запит;
 * - кожне підписане «AI illustration» на самій картинці (`AI_LABEL`,
 *   AI Act ст. 50(4));
 * - запит і модель кожного — у `apps/web/src/data/page-photos.json`;
 * - НІКОЛИ на сторінці кемпінгу чи компанії: там і далі «no AI-generated
 *   images of places nobody has visited».
 * Фото, яке власник поставить сам, підпису не має — це його знімок.
 */
export class AttributionPagePhotos1797960000000 implements MigrationInterface {
  name = 'AttributionPagePhotos1797960000000';

  readonly previous = new AttributionWeatherForecast1797930000000().page;

  readonly page = (() => {
    const body = replaceOnce(
      this.previous.body,
      '## Typefaces {#type}',
      `## Illustrations of countries, routes and topics {#illustrations}

The pictures at the top of country, route, camper-rental and guide pages are AI-generated illustrations, and each one says so on the picture itself: “AI illustration”. They were made with the Seedream 5.5 model from ByteDance, run through the hosted service at [fal.run](https://fal.run/bytedance/seedream/v5.5/text-to-image), from a text prompt alone: no photograph or other picture was supplied. We keep the prompt of every one on record.

They show the kind of landscape and the kind of camping a page is about — a lake in Austria, a coast road in Dalmatia — and not any particular campsite or company. A campsite page never carries one; a region shows its country’s picture, and a rental company’s page shows its home country, never its vehicles. Where we replace an illustration with a real photograph, the label goes with it.

## Typefaces {#type}`,
    );
    return {
      // Літерал, а не `this.previous.slug`: сторож реєстру шукає останню
      // міграцію документа за `slug: '…'` у тексті файла.
      slug: 'attribution',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.6',
      effectiveFrom: '2026-11-17',
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
