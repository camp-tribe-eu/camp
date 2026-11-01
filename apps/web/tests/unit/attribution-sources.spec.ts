import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { legalPage } from '@/lib/legal';
import { SEEDED, seededHtml } from './legal-cms';
import { visibleText } from './rendered-text';

/**
 * Сторінка «Data and attribution» обіцяє назвати «exactly what, from whom,
 * and under which licence». Цей тест тримає обіцянку в обидва боки.
 *
 * 🔴 ЧОМУ ЦЕ ЛІЦЕНЗІЯ, А НЕ СТИЛЬ. CC BY 4.0, Licence Ouverte, IODL,
 * умови CEMS і MeteoAlarm дають право показувати чужі дані ЗА УМОВИ
 * атрибуції. Джерело, яке є в коді й відсутнє на цій сторінці, — це дані,
 * які ми показуємо, не виконавши умови, за якої маємо право їх показувати.
 * 1.0 (23.09.2026) не називала дванадцять таких джерел.
 *
 * 🔴 КОРПУС — ЦЕ КОД, А НЕ ПЕРЕЛІК У ЦЬОМУ ФАЙЛІ. Хости беруться з файлів,
 * де джерела справді визначені (`SOURCE_FILES`), регулярним виразом по
 * літералах `https://…`. Новий хост у будь-якому з цих файлів без рядка на
 * сторінці — падіння, яке називає хост і файл. Перелік хостів у самому
 * тесті був би другою копією того, що він перевіряє.
 *
 * 🔴 ЧИТАЄТЬСЯ ВІДДАНИЙ HTML сторінки — `href` посилань і видимий текст
 * крізь той самий `LegalProse`, що й справжня сторінка; текст — із міграцій
 * (`legal-cms.ts`). Правка в CMS цьому файлу невидима; це названо там.
 *
 * Зворотний бік: кожне зовнішнє посилання сторінки веде або на хост із коду,
 * або на текст ліцензії чи бібліотеку з `REFERENCE_HOSTS` — із причиною.
 * Рядок про джерело, якого в коді немає, — теж падіння з назвою хоста.
 */

// `__dirname`, а не `import.meta`: Playwright компілює специфікації в CommonJS.
const ROOT = resolve(__dirname, '..', '..', '..', '..');

/**
 * Де в коді визначені зовнішні джерела, що потрапляють на сторінки або в
 * браузер читача. Одна причина на файл.
 */
const SOURCE_FILES: ReadonlyArray<{ path: string; why: string }> = [
  { path: 'apps/web/src/lib/sources.ts', why: 'per-record sources: OSM, DATAtourisme, EEA bathing water, EEA air quality' },
  { path: 'apps/web/src/lib/map-sources.ts', why: 'basemap tiles the browser loads' },
  { path: 'apps/web/src/data/satellite-sources.json', why: 'national orthophoto services the browser loads' },
  { path: 'apps/web/src/lib/webcams.ts', why: 'webcam frames the browser loads' },
  { path: 'scripts/windy/fetch-webcams.mjs', why: 'webcam metadata import' },
  { path: 'apps/web/src/lib/warnings.ts', why: 'MeteoAlarm link the licence dictates' },
  { path: 'scripts/meteoalarm/fetch-warnings.mjs', why: 'weather warning feeds' },
  { path: 'scripts/meteoalarm/zone-coverage.mjs', why: 'geometry that decides which warnings concern which campsite' },
  { path: 'scripts/meteoalarm/resolve-areas.mjs', why: 'the same geometry sources, by scheme' },
  { path: 'scripts/edo/fetch-drought.mjs', why: 'drought layer' },
  { path: 'apps/web/src/data/drought.json', why: 'drought layer as shipped (meta)' },
  { path: 'scripts/effis/fetch-wildfires.mjs', why: 'wildfire layer' },
  { path: 'apps/web/src/data/wildfires.json', why: 'wildfire layer as shipped (meta)' },
  { path: 'apps/api/src/air/source.ts', why: 'EEA air quality: the hourly file and the model service' },
  { path: 'apps/api/src/bathing/source.ts', why: 'EEA bathing water service' },
  { path: 'apps/api/src/fuel/stations.ts', why: 'per-station fuel prices, three ministries' },
  { path: 'apps/web/src/lib/route-services.ts', why: 'the public pages those prices are credited to' },
  { path: 'scripts/fuel/fetch-fuel-prices.mjs', why: 'country fuel averages' },
  { path: 'apps/web/src/data/fuel-prices.json', why: 'country fuel averages as shipped (meta)' },
  { path: 'apps/api/src/osm/compute-context.ts', why: 'elevation and relief' },
  { path: 'scripts/osm-pipeline/geofabrik-url.sh', why: 'OSM country extracts' },
  { path: 'scripts/osm-pipeline/load-boundaries.sh', why: 'Natural Earth boundaries' },
];

/**
 * Хости в тих файлах, які НЕ є джерелами, і чому. Кожен — назване
 * рішення, а не мовчазний пропуск.
 */
const NOT_A_SOURCE: Readonly<Record<string, string>> = {
  'standards.iso.org': 'an ISO schema identifier inside the query string of IGN France’s catalogue URL',
  'cartes.gouv.fr': 'the page IGN France’s service points to for its conditions — a licence text, not data; listed in REFERENCE_HOSTS',
  'meteo.hr': 'a CAP sender identifier used as a self-test fixture in fetch-warnings.mjs; nothing is fetched from it',
  'skaping.com': 'a camera operator’s URL used as a self-test fixture in fetch-webcams.mjs; nothing is fetched from it',
  'x': 'a self-test fixture',
  'opengis.net': 'the OGC XML namespace in the WFS request fetch-wildfires.mjs builds; nothing is fetched from it',
};

/**
 * Хости, на які сторінка МОЖЕ посилатися, не маючи їх у коді: тексти
 * ліцензій, бібліотеки, каталожні сторінки джерел, які самі в коді стоять
 * іншим хостом. Кожен — із причиною.
 */
const REFERENCE_HOSTS: Readonly<Record<string, string>> = {
  'opendatacommons.org': 'ODbL licence text',
  'creativecommons.org': 'CC BY 4.0 licence text',
  'etalab.gouv.fr': 'Licence Ouverte 2.0 text',
  'dati.gov.it': 'IODL 2.0 text',
  'datos.gob.es': 'datos.gob.es general conditions of reuse',
  'cartes.gouv.fr': 'IGN France’s conditions of use, which its service points to',
  'ec.europa.eu': 'Eurostat’s download conditions for GISCO geodata',
  'openfontlicense.org': 'SIL Open Font License text',
  'maplibre.org': 'the map library (BSD-3-Clause), a dependency rather than a data source',
  'openmaptiles.org': 'the tile schema, named by the tile provider’s own credit line',
  'openfreemap.org': 'the tile provider’s home page; its tiles come from tiles.openfreemap.org, which is in code',
  'spacedata.copernicus.eu': 'the Copernicus DEM catalogue record; the data reaches us through api.open-meteo.com, which is in code',
  'open-meteo.com': 'Open-Meteo’s home page and terms; the endpoint api.open-meteo.com is in code',
  'naturalearthdata.com': 'Natural Earth’s home page; its files come from naciscdn.org and raw.githubusercontent.com, which are in code',
  'datatourisme.fr': 'DATAtourisme’s home page, which is also in code',
  'eea.europa.eu': 'the EEA Datahub and legal notice, which are also in code',
  'openstreetmap.org': 'OpenStreetMap, which is also in code',
  'meteoalarm.org': 'MeteoAlarm’s terms, which are also in code',
  'windy.com': 'Windy’s terms, which is also in code',
};

const HOST = /https?:\/\/([a-z0-9][a-z0-9.-]*[a-z0-9])(?=[/?#"'`\s)\]<,]|$)/gi;
const normalise = (h: string) => h.toLowerCase().replace(/^www\./, '');
const isLocalOrFixture = (h: string) =>
  /^(localhost|127\.0\.0\.1)$/.test(h) || /\.(example|test|invalid|localhost)$/.test(h) || /^camptribe\.eu$/.test(h);

/** Хости джерел, і в яких файлах кожен стоїть. */
function hostsInCode(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const f of SOURCE_FILES) {
    const text = readFileSync(join(ROOT, f.path), 'utf8');
    for (const m of text.matchAll(HOST)) {
      const host = normalise(m[1]);
      if (isLocalOrFixture(host) || host in NOT_A_SOURCE) continue;
      const files = found.get(host) ?? new Set<string>();
      files.add(f.path);
      found.set(host, files);
    }
  }
  return found;
}

/** Хости зовнішніх посилань відданої сторінки. */
function hostsOnPage(html: string): Set<string> {
  const hosts = new Set<string>();
  for (const m of html.matchAll(/\bhref="([^"]+)"/g)) {
    const href = m[1].replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(href)) continue;
    hosts.add(normalise(new URL(href).hostname));
  }
  return hosts;
}

/**
 * Чи покриває хост сторінки хост із коду — лише рівність (після `www.`).
 * Батьківський домен НЕ рахується: `ec.europa.eu` на сторінці не є
 * рядком ані про GISCO, ані про Weekly Oil Bulletin, хоч обидва під ним.
 */
const covers = (pageHost: string, codeHost: string) => pageHost === codeHost;

test.describe('attribution: every source in code is on the page, and nothing else is', () => {
  const html = seededHtml('attribution');
  const page = hostsOnPage(html);
  const code = hostsInCode();

  test('the corpus is not empty and the files exist', () => {
    expect(code.size, 'no source hosts found in SOURCE_FILES').toBeGreaterThan(10);
    expect(page.size, 'no external links on the attribution page').toBeGreaterThan(5);
  });

  test('every source host in code has a link on the attribution page', () => {
    const missing = [...code.entries()]
      .filter(([host]) => ![...page].some((p) => covers(p, host)))
      .map(([host, files]) => `${host}  ←  ${[...files].join(', ')}`);
    expect(
      missing,
      `sources in code with no line on the attribution page (${missing.length} of ${code.size}):\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  test('every external link on the page is a source in code or a named reference', () => {
    const stray = [...page].filter((h) => !code.has(h) && !(h in REFERENCE_HOSTS));
    expect(
      stray,
      `attribution page links to hosts that are neither in code nor in REFERENCE_HOSTS: ${stray.join(', ')}`,
    ).toEqual([]);
  });

  test('a reference host that is also in code is not a dead allowance', () => {
    // 🔴 REFERENCE_HOSTS that are "also in code" must really be in code,
    // or the comment beside them is a falsehood that would outlive the code.
    const claimed = Object.entries(REFERENCE_HOSTS)
      .filter(([, why]) => /also in code/.test(why))
      .map(([h]) => h)
      .filter((h) => !code.has(h));
    expect(claimed, `REFERENCE_HOSTS claims these are in code and they are not: ${claimed.join(', ')}`).toEqual([]);
  });

  test('the notices the licences dictate are in the visible text', () => {
    const text = visibleText(html);
    // Eurostat GISCO download conditions: the copyright notice, verbatim.
    expect(text).toContain('© EuroGeographics for the administrative boundaries');
    // MeteoAlarm terms clause 5: the source for information spanning countries.
    expect(text).toContain('EUMETNET – MeteoAlarm');
    // CEMS terms: the notice for modified data, with a four-digit year.
    expect(text).toMatch(/Contains modified Copernicus Emergency Management Service information \d{4}/);
    // Windy’s terms: the credit the components print.
    expect(text).toContain('Webcams provided by windy.com');
    // IGN Spain: the attribution string read from the service.
    expect(text).toContain('CC BY 4.0 scne.es');
  });

  test('the registry and the seeded text carry the same version', () => {
    const seeded = SEEDED.find((d) => d.slug === 'attribution');
    expect(seeded?.version).toBe(legalPage('attribution')?.version);
    expect(seeded?.effectiveFrom).toBe(legalPage('attribution')?.effectiveFrom);
  });
});
