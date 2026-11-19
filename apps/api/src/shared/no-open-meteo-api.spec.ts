import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// 🔴 CAMP-484, пункт 4: «сторож, що не дає виклику повернутись».
//
// Безкоштовний API Open-Meteo — лише некомерційний («You may only use the
// free API services for non-commercial purposes»), а обовʼязок вмикається
// першим афіліат-посиланням. Висоти й прогноз беремо з відкритого відра
// під CC BY 4.0. До 19.11.2026 сторож стояв лише над `forecast/`, а виклик
// висот жив у `osm/compute-context.ts` — тобто там, де він уже раз був,
// його ніхто не стеріг. Тепер — увесь код API і `scripts/`.
//
// Коментарі можуть називати хост (вони пояснюють, ЧОМУ його немає); код —
// ні. Відро `openmeteo.s3.amazonaws.com` — не API-хост і дозволене.

const ROOT = join(__dirname, '..', '..', '..', '..');
const DIRS = ['apps/api/src', 'scripts'];
const CODE = /\.(m?[jt]s|py|sh)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // Міграції — історичний ТЕКСТ правових сторінок (посилання на сайт
    // Open-Meteo в атрибуції), незмінний за побудовою; не виклики.
    if (
      name === 'node_modules' ||
      name === 'migrations' ||
      name.startsWith('.')
    )
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CODE.test(name) && !name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Код без коментарів: `/* *\/`, `//` і `#` на початку рядка. */
export function codeOf(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|#)/.test(l))
    .join('\n');
}

/** Хости Open-Meteo API у коді (точний збіг частини, не підрядок). */
export function apiHosts(code: string): string[] {
  return (
    code
      .split(/[^\w.:/-]+/)
      .flatMap((t) => t.split('/'))
      // Сайт (`open-meteo.com`, `www.`) — посилання для атрибуції, не API.
      // API-хости завжди піддомени: api., customer-api., archive-api., …
      .filter((h) => h.endsWith('.open-meteo.com') && !h.startsWith('www.'))
  );
}

describe('🔴 CAMP-484: no code calls the Open-Meteo API', () => {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d)));

  it('reads the tree it guards (not nothing)', () => {
    const rel = files.map((f) => relative(ROOT, f));
    expect(rel).toEqual(
      expect.arrayContaining([
        'apps/api/src/osm/compute-context.ts',
        'apps/api/src/forecast/forecast.ts',
        'scripts/elevation/refill.py',
      ]),
    );
    expect(files.length).toBeGreaterThan(200);
  });

  it('no file names an API host in code', () => {
    const offenders = files
      .map(
        (f) =>
          [
            relative(ROOT, f),
            apiHosts(codeOf(readFileSync(f, 'utf8'))),
          ] as const,
      )
      .filter(([, h]) => h.length > 0)
      .map(([f, h]) => `${f}: ${h.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('the reader is not blind: a call is caught, a comment and the bucket are not', () => {
    expect(
      apiHosts(codeOf("const u = 'https://api.open-meteo.com/v1/elevation';")),
    ).toEqual(['api.open-meteo.com']);
    expect(
      apiHosts(
        codeOf('url = "https://customer-api.open-meteo.com/v1/forecast"'),
      ),
    ).toEqual(['customer-api.open-meteo.com']);
    expect(
      apiHosts(codeOf('// was api.open-meteo.com, now the bucket')),
    ).toEqual([]);
    expect(apiHosts(codeOf('# api.open-meteo.com is non-commercial'))).toEqual(
      [],
    );
    expect(
      apiHosts(codeOf("const b = 'https://openmeteo.s3.amazonaws.com/data';")),
    ).toEqual([]);
  });
});
