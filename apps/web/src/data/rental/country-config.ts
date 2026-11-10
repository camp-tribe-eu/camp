import type { MetricKey } from '@/lib/rental';

/**
 * Те в країні оренди, що НЕ є текстом — CAMP-479.
 *
 * 🔴 ЧОМУ ЦЕ ЛИШИЛОСЬ У КОДІ, КОЛИ РЕШТА ПЕРЕЇХАЛА В CMS.
 *
 * `metric` і `kind` не показуються читачеві: вони обирають, ЯКЕ
 * обчислення над нашою базою піде на сторінку. Редактор, який змінив би
 * `metric` на неіснуючий, зламав би сторінку, а не текст — і дізнались
 * би ми про це з її падіння, а не з рецензії.
 *
 * `definiteArticle` — англійська граматика назви: «the Netherlands», але
 * «Germany». Вона прив'язана до самої назви країни, а не до того, що
 * ми про неї написали.
 *
 * 🔴 ПЕРЕЛІК ТУТ НЕ ВИРІШУЄ, ЯКІ КРАЇНИ ПУБЛІКУЮТЬСЯ. Це вирішує CMS:
 * країна без сторінки не виходить із API. Код без рядка тут дістане
 * замовчування — і сторінка все одно збудується, лише без заміру.
 */
export interface CountryConfig {
  metric: MetricKey;
  kind: 'share' | 'count' | 'per-region';
  definiteArticle?: true;
}

export const COUNTRY_CONFIG: Readonly<Record<string, CountryConfig>> = {
  de: { metric: 'rvPark', kind: 'count' },
  fr: { metric: 'camperStop', kind: 'count' },
  it: { metric: 'electricity', kind: 'share' },
  es: { metric: 'greyWater', kind: 'share' },
  nl: { metric: 'shower', kind: 'share', definiteArticle: true },
  at: { metric: 'water', kind: 'share' },
  hr: { metric: 'paid', kind: 'share' },
  si: { metric: 'spots', kind: 'per-region' },
  pt: { metric: 'vehicleOnly', kind: 'share' },
  se: { metric: 'wild', kind: 'share' },
  dk: { metric: 'wild', kind: 'count' },
  ie: { metric: 'rvPark', kind: 'share' },
};
