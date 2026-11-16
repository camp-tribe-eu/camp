import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';
import { AttributionBannerImages1796600000000 } from './1796600000000-AttributionBannerImages';

/**
 * Сторінка «Data and attribution» 1.4 → 1.5: прогноз погоди на сторінці
 * кемпінгу — CAMP-477.
 *
 * 🔴 ЦЕ НОВЕ ДЖЕРЕЛО, І СТОРІНКА АТРИБУЦІЇ — ЄДИНЕ МІСЦЕ, ДЕ ВОНО НАЗВАНЕ.
 * Прогноз приходить із відкритого відра Open-Meteo на AWS Open Data
 * (CC BY 4.0), модель ECMWF IFS. Умова ліцензії: посилання біля місця,
 * де дані показано (є на самій секції), і зазначення, що дані змінено
 * — ми рахуємо добові значення самі, і розділ це каже.
 *
 * 🔴 ТЕКСТ НЕ ОБІЦЯЄ БІЛЬШЕ, НІЖ ТРИМАЄ КОД. Два твердження, кожне з
 * тестом, що читає код або відданий HTML, а не цей рядок:
 *   · «браузер просить наш сервер і не звертається ні до Open-Meteo, ні
 *     до Amazon» — `tests/e2e/forecast.spec.ts` перелічує кожен запит
 *     справжньої сторінки й падає на будь-якому з двох хостів;
 *   · «безкоштовного API не викликаємо» — `forecast.spec.ts` в API
 *     читає код теки й падає на будь-якому імені хоста Open-Meteo.
 *
 * 🔴 ECMWF ВИМАГАЄ ВЛАСНОГО РЯДКА, І ВІН Є. Умови використання відкритих
 * даних ECMWF (apps.ecmwf.int/datasets/licences/general, прочитано
 * 16.11.2026): атрибуція «must be displayed prominently» і містить
 * «based on data and products of the European Centre for Medium-Range
 * Weather Forecasts (ECMWF)». Той самий рядок стоїть на секції; запис про
 * прочитане — у `legal-review.json`.
 */
export class AttributionWeatherForecast1797930000000 implements MigrationInterface {
  name = 'AttributionWeatherForecast1797930000000';

  /** Те, що 1.4 поклала в базу — береться з її міграції, не передруковується. */
  readonly previous = new AttributionBannerImages1796600000000().page;

  readonly page = (() => {
    const body = replaceOnce(
      this.previous.body,
      '## Drought {#drought}',
      `## Weather forecast {#forecast}

The seven-day forecast on a campsite page is a model forecast from the European Centre for Medium-Range Weather Forecasts (ECMWF), its IFS model on a grid of 0.25 degrees, about 25 km. It reaches us through [Open-Meteo](https://open-meteo.com/), which publishes it in an open data bucket on [AWS Open Data](https://registry.opendata.aws/open-meteo/) under CC BY 4.0; Open-Meteo’s [licence page](https://open-meteo.com/en/licence) lists the ECMWF data among the sources it uses under CC BY, and ECMWF’s own [terms of use](https://apps.ecmwf.int/datasets/licences/general/) for its open data ask for this acknowledgement, which the forecast carries: this output is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF).

Our server reads the files from [openmeteo.s3.amazonaws.com](https://openmeteo.s3.amazonaws.com/) and works out the daily figures itself: the highest and lowest temperature, the rain in millimetres and the word for the sky, which are our own thresholds applied to cloud cover and rain. That is a change to the data and it is stated here. Neither Open-Meteo nor ECMWF endorses this page.

Your browser asks our own server for the forecast. It does not contact Open-Meteo or Amazon, so neither receives your address. A forecast is for the area around the campsite, not for the pitch; when we cannot read one, the page shows no forecast section at all.

## Drought {#drought}`,
    );
    return {
      // Літерал, а не `this.previous.slug`: сторож реєстру шукає останню
      // міграцію документа за `slug: '…'` у тексті файла.
      slug: 'attribution',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '1.5',
      effectiveFrom: '2026-11-16',
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
