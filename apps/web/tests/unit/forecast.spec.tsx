import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import { ForecastPanel } from '@/components/forecast-panel';
import {
  dayLabel,
  forecastUrl,
  formatDeg,
  formatMm,
  parseForecast,
  watchForForecast,
  type Forecast,
  type ForecastDay,
} from '@/lib/forecast';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-477 — the forecast section, read out of the HTML it renders.
//
// 🔴 The expected strings are typed here, not produced by the code under
// test: "Mon 16 Nov", "Heavy rain", "19.9 mm" are what a reader is meant
// to see for the Vendée figures the API returned on 16.11.2026.

const VENDEE: ForecastDay[] = [
  { date: '2026-11-16', tMax: 16, tMin: 13, precipMm: 19.9, condition: 'heavy-rain' },
  { date: '2026-11-17', tMax: 16, tMin: 14, precipMm: 22.2, condition: 'heavy-rain' },
  { date: '2026-11-18', tMax: 15, tMin: 13, precipMm: 13.4, condition: 'heavy-rain' },
  { date: '2026-11-19', tMax: 14, tMin: 11, precipMm: 10.5, condition: 'heavy-rain' },
  { date: '2026-11-20', tMax: 14, tMin: 11, precipMm: 7.6, condition: 'rain' },
  { date: '2026-11-21', tMax: 12, tMin: 7, precipMm: 1.5, condition: 'rain' },
  { date: '2026-11-22', tMax: 14, tMin: 11, precipMm: 0, condition: 'cloudy' },
];
const body = (days: unknown[]) => ({ model: 'ecmwf_ifs025', runAt: '2026-11-16T00:00:00.000Z', days });

const html = (days: ForecastDay[], runAt: string | null = '2026-11-16T00:00:00.000Z') =>
  renderComponent(ForecastPanel, { forecast: { days, runAt } });

test.describe('the panel, as served', () => {
  test('seven days: heading, a row per day, and the words a reader reads', async () => {
    const h = await html(VENDEE);
    const text = visibleText(h);
    expect(text).toContain('7-day forecast');
    expect((h.match(/data-testid="forecast-day"/g) ?? []).length).toBe(7);
    expect(text).toContain('Mon 16 Nov');
    expect(text).toContain('Sun 22 Nov');
    expect(text).toContain('Heavy rain');
    expect(text).toContain('Cloudy');
    expect(text).toContain('19.9 mm');
    expect(text).toContain('0 mm');
    expect(text).toContain('16° / 13°');
  });

  test('the heading counts the days actually shown, never a promised seven', async () => {
    expect(visibleText(await html(VENDEE.slice(0, 5)))).toContain('5-day forecast');
    expect(visibleText(await html(VENDEE.slice(0, 5)))).not.toContain('7-day');
    expect(visibleText(await html(VENDEE.slice(0, 3)))).toContain('3-day forecast');
  });

  test('a first row says Mon 16 Nov with its figures in ONE row, not spread', async () => {
    const h = await html(VENDEE);
    const row = h.split('data-testid="forecast-day"')[1].split('</tr>')[0];
    const t = visibleText(`<table><tbody><tr>${row}</tr></tbody></table>`);
    expect(t).toContain('Mon 16 Nov');
    expect(t).toContain('Heavy rain');
    expect(t).toContain('16° / 13°');
    expect(t).toContain('19.9 mm');
    expect(t).not.toContain('22.2');
  });

  test('the credit is on the page, with the link, in the words the card gave', async () => {
    const h = await html(VENDEE);
    expect(visibleText(h)).toContain('Weather data by Open-Meteo.com (CC BY 4.0)');
    expect(h).toMatch(/<a [^>]*href="https:\/\/open-meteo\.com\/"[^>]*>Weather data by Open-Meteo\.com<\/a>/);
    expect(h).toMatch(/href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/);
  });

  test('ECMWF is credited in the words its terms ask for', async () => {
    const t = visibleText(await html(VENDEE)).replace(/\s+/g, ' ');
    expect(t).toContain(
      'Based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF)',
    );
  });

  test('it says what the numbers are: an area, not the pitch', async () => {
    const t = visibleText(await html(VENDEE));
    expect(t).toContain('about 25 km');
    expect(t).toContain('not for the pitch itself');
  });

  test('no days, no section: not a heading, not a frame', async () => {
    const h = await html([]);
    expect(h).toBe('');
  });

  test('the freezing minus is a real minus and zero is never "-0°"', async () => {
    const h = await html([
      ...VENDEE.slice(0, 4),
      { date: '2026-11-20', tMax: 1, tMin: -3, precipMm: 3, condition: 'snow' },
      { date: '2026-11-21', tMax: 0, tMin: -0.4, precipMm: 0, condition: 'cloudy' },
    ]);
    const t = visibleText(h);
    expect(t).toContain('1° / −3°');
    expect(t).toContain('0° / 0°');
    expect(t).not.toContain('-0');
  });
});

test.describe('the trust line', () => {
  test('carries the trust word, the model, its run and the 25 km area', async () => {
    const h = await html(VENDEE);
    expect(h).toContain('data-trust-status="imported"');
    const t = visibleText(h).replace(/\s+/g, ' ');
    expect(t).toContain('Imported · Model: ECMWF IFS, via Open-Meteo. Model run 16 Nov, 00:00 UTC. Updated about every 6 hours.');
    expect(t).toContain('A forecast for the area (about 25 km), not for the pitch.');
  });
  test('an unreadable run time drops that sentence, not the section', async () => {
    const t = visibleText(await html(VENDEE, null)).replace(/\s+/g, ' ');
    expect(t).toContain('Imported · Model: ECMWF IFS, via Open-Meteo. Updated about every 6 hours.');
    expect(t).not.toContain('Model run');
  });
});

test.describe('parseForecast: one bad day costs one day', () => {
  test('a full answer is seven days in date order', () => {
    const shuffled = [...VENDEE].reverse();
    expect(parseForecast(body(shuffled))?.map((d) => d.date)).toEqual(
      VENDEE.map((d) => d.date),
    );
  });

  test.describe('each of these breaks ONE day, and six remain', () => {
    const bad: Array<[string, unknown]> = [
      ['a date that is not one', { ...VENDEE[2], date: '2026-02-30' }],
      ['a temperature as text', { ...VENDEE[2], tMax: '16' }],
      ['a NaN', { ...VENDEE[2], tMin: null }],
      ['low above high', { ...VENDEE[2], tMax: 3, tMin: 9 }],
      ['negative rain', { ...VENDEE[2], precipMm: -1 }],
      ['an unknown sky word', { ...VENDEE[2], condition: 'tornado' }],
      ['not an object', 'x'],
      ['null', null],
    ];
    for (const [name, rowBad] of bad) {
      test(name, () => {
        const days = VENDEE.map((d, i) => (i === 2 ? rowBad : d));
        const got = parseForecast(body(days));
        expect(got?.length).toBe(6);
        expect(got?.map((d) => d.date)).not.toContain('2026-11-18');
      });
    }
  });

  test('a repeated date is kept once', () => {
    const got = parseForecast(body([...VENDEE.slice(0, 5), VENDEE[0]]));
    expect(got?.map((d) => d.date)).toEqual(VENDEE.slice(0, 5).map((d) => d.date));
  });

  test('two days are too few: no section; three are enough', () => {
    expect(parseForecast(body(VENDEE.slice(0, 2)))).toBeNull();
    expect(parseForecast(body(VENDEE.slice(0, 3)))?.length).toBe(3);
  });

  test('nothing that is not an answer becomes one', () => {
    for (const b of [null, undefined, 'x', 5, {}, { days: 'x' }, { days: {} }, []]) {
      expect(parseForecast(b)).toBeNull();
    }
  });
});

test.describe('formatting', () => {
  test('the weekday belongs to the calendar date, not to the reader', () => {
    // A reader in UTC+14 is already on the next calendar day at noon UTC.
    const was = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      expect(dayLabel('2026-11-16')).toBe('Mon 16 Nov');
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
    expect(dayLabel('2026-11-16')).toBe('Mon 16 Nov');
    expect(dayLabel('2026-12-31')).toBe('Thu 31 Dec');
    expect(dayLabel('2027-01-01')).toBe('Fri 1 Jan');
  });
  test('degrees and millimetres', () => {
    expect(formatDeg(16.4)).toBe('16°');
    expect(formatDeg(-0.2)).toBe('0°');
    expect(formatDeg(-3)).toBe('−3°');
    expect(formatMm(0)).toBe('0 mm');
    expect(formatMm(10)).toBe('10 mm');
    expect(formatMm(19.9)).toBe('19.9 mm');
  });
});

test.describe('the request', () => {
  test('goes to OUR API and names the campsite, not a point', () => {
    expect(forecastUrl('camp-bovec', 'https://camptribe.eu/api')).toBe(
      'https://camptribe.eu/api/forecast?slug=camp-bovec',
    );
    expect(forecastUrl('a b/c')).toBe('/forecast?slug=a%20b%2Fc');
  });

});

test.describe('watchForForecast', () => {
  const ok = (b: unknown) => async () => ({ ok: true, json: async () => b });
  const el = {} as Element;

  test('an answer is parsed and handed over, once', async () => {
    const got: Array<Forecast | null> = [];
    watchForForecast(null, 'u', (d) => got.push(d), { fetchImpl: ok(body(VENDEE)) });
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toHaveLength(1);
    expect(got[0]?.days.length).toBe(7);
    expect(got[0]?.runAt).toBe('2026-11-16T00:00:00.000Z');
  });

  for (const [name, fetchImpl] of [
    // A refusal that still carries a well-formed body (a proxy's error
    // page, a half-written answer) is a refusal.
    ['a 503 with a body that parses', async () => ({ ok: false, json: async () => body(VENDEE) })],
    ['a network error', async () => Promise.reject(new Error('offline'))],
    ['a body that is not JSON', async () => ({ ok: true, json: async () => Promise.reject(new Error('x')) })],
    ['an answer with two days', ok(body(VENDEE.slice(0, 2)))],
  ] as const) {
    test(`${name} ends in null, which draws nothing`, async () => {
      const got: Array<Forecast | null> = [];
      watchForForecast(null, 'u', (d) => got.push(d), { fetchImpl });
      await new Promise((r) => setTimeout(r, 0));
      expect(got).toEqual([null]);
    });
  }

  test('with an observer nothing is asked until the reader is near', async () => {
    let asked = 0;
    let near: () => void = () => {};
    watchForForecast(el, 'u', () => {}, {
      fetchImpl: async () => {
        asked++;
        return { ok: true, json: async () => body(VENDEE) };
      },
      observe: (_e, onNear) => {
        near = onNear;
        return () => {};
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toBe(0);
    near();
    expect(asked).toBe(1);
  });

  test('after the cleanup a late answer is dropped', async () => {
    const got: unknown[] = [];
    const stop = watchForForecast(null, 'u', (d) => got.push(d), {
      fetchImpl: ok(body(VENDEE)),
    });
    stop();
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual([]);
  });
});

test.describe('the source of the data, in the code a browser runs', () => {
  const SRC = join(__dirname, '../../src');
  const files = ['lib/forecast.ts', 'components/forecast-panel.tsx'].map(
    (f) => [f, readFileSync(join(SRC, f), 'utf8')] as const,
  );
  const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('nothing the browser runs names a data host: no amazonaws, no open-meteo API', () => {
    for (const [f, s] of files) {
      const c = code(s);
      expect(`${f}: ${c.match(/amazonaws\.com/g) ?? []}`).toBe(`${f}: `);
      expect(`${f}: ${c.match(/(?:api|customer-api|archive-api)\.open-meteo/g) ?? []}`).toBe(`${f}: `);
    }
  });

  test('the only fetch is of the address forecastUrl builds', () => {
    const calls = files.flatMap(([f, s]) =>
      [...code(s).matchAll(/\bfetch\(([^)]*)\)/g)].map((m) => `${f}: ${m[1]}`),
    );
    expect(calls).toEqual(['components/forecast-panel.tsx: u']);
  });
});
