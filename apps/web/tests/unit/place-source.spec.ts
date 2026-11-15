import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import { readPlace, readSuggestions, resolveCampsite, suggestPlaces } from '@/lib/place-source';

// CAMP-456 — читання відповіді `GET /places/*`. Відповідь API — дані, які
// можуть брехати: один зіпсований запис коштує одного запису.

const good = (over: Record<string, unknown> = {}) => ({
  kind: 'city',
  name: 'Antwerpen',
  country: 'be',
  lat: 51.22,
  lon: 4.4,
  ...over,
});
const camp = (over: Record<string, unknown> = {}) =>
  good({ kind: 'campsite', name: 'Camping Bled', country: 'si', slug: 'camping-bled', ...over });

test.describe('readPlace', () => {
  test('місто: підпис — назва й країна словами, а не кодом', () => {
    expect(readPlace(good())).toMatchObject({ kind: 'city', name: 'Antwerpen', label: 'Antwerpen, Belgium' });
  });

  test('кемпінг: підпис каже, що це кемпінг, і slug збережено', () => {
    expect(readPlace(camp())).toMatchObject({
      label: 'Camping Bled (campsite), Slovenia',
      slug: 'camping-bled',
    });
  });

  test('🔴 кожен із способів бути зіпсованим — окремо дає null, а не напівмісце', () => {
    const bad: unknown[] = [
      null,
      'Antwerpen',
      [],
      good({ kind: 'galaxy' }),
      good({ kind: 5 }),
      good({ name: '' }),
      good({ name: '   ' }),
      good({ name: 'x'.repeat(201) }),
      good({ name: 7 }),
      good({ country: 'BE' }),
      good({ country: 'bel' }),
      good({ country: undefined }),
      good({ lat: '51' }),
      good({ lat: NaN }),
      good({ lat: 91 }),
      good({ lon: -181 }),
      good({ lon: Infinity }),
      camp({ slug: undefined }),
      camp({ slug: '../etc/passwd' }),
      camp({ slug: 'UPPER' }),
      camp({ slug: 'a'.repeat(201) }),
    ];
    for (const b of bad) expect(readPlace(b), JSON.stringify(b)).toBeNull();
  });

  test('межі кулі включно', () => {
    expect(readPlace(good({ lat: 90, lon: 180 }))).not.toBeNull();
    expect(readPlace(good({ lat: -90, lon: -180 }))).not.toBeNull();
  });

  test('назва виходить текстом: розмітка в ній лишається розміткою-літерами', () => {
    const p = readPlace(good({ name: '<img src=x onerror=alert(1)>' }));
    expect(p?.label).toBe('<img src=x onerror=alert(1)>, Belgium');
  });
});

test.describe('readSuggestions', () => {
  test('🔴 один зіпсований запис коштує одного запису', () => {
    const r = readSuggestions(200, { items: [good(), good({ lat: 999 }), camp(), null] });
    expect(r.status).toBe('found');
    expect(r.status === 'found' && r.places.map((p) => p.name)).toEqual(['Antwerpen', 'Camping Bled']);
  });

  test('🔴 «нічого не знайдено» і «пошук не відповів» — різні відповіді', () => {
    expect(readSuggestions(200, { items: [] })).toEqual({ status: 'none' });
    // Усі записи зіпсовані: це теж «нічого показати», але не «збій».
    expect(readSuggestions(200, { items: [good({ lat: 999 })] })).toEqual({ status: 'none' });
    for (const [status, body] of [
      [200, null],
      [200, {}],
      [200, { items: 'x' }],
      [200, []],
      [400, { items: [good()] }],
      [429, { items: [good()] }],
      [500, { items: [good()] }],
    ] as const) {
      expect(readSuggestions(status, body), `${status} ${JSON.stringify(body)}`).toEqual({ status: 'failed' });
    }
  });
});

const respond = (status: number, body: unknown) => async () =>
  ({ status, json: async () => body }) as unknown as Response;

test.describe('suggestPlaces', () => {
  test('🔴 порожня адреса API — «unavailable», і до мережі не доходить нічого', async () => {
    let called = 0;
    const out = await suggestPlaces('ant', undefined, '', async () => {
      called++;
      throw new Error('no');
    });
    expect(out).toEqual({ status: 'unavailable' });
    expect(called).toBe(0);
  });

  test('🔴 запит іде POST-ом із тілом, а набраний текст НЕ потрапляє в адресу — інакше він осів би в журналі доступу', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    await suggestPlaces('a b&c=d#e', undefined, 'https://api.example', async (url, init) => {
      seen.push({ url, init });
      return respond(200, { items: [] })();
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.example/places/suggest');
    expect(seen[0].init.method).toBe('POST');
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ q: 'a b&c=d#e' });
    expect(new Headers(seen[0].init.headers).get('content-type')).toBe('application/json');
  });

  test('мережа впала, відповідь не JSON — failed', async () => {
    expect(
      await suggestPlaces('ant', undefined, 'https://api.example', async () => {
        throw new Error('down');
      }),
    ).toEqual({ status: 'failed' });
    expect(
      await suggestPlaces('ant', undefined, 'https://api.example', async () =>
        ({ status: 200, json: async () => { throw new Error('not json'); } }) as unknown as Response),
    ).toEqual({ status: 'failed' });
  });

  test('скасований запит не кидає: це failed, який сторінка відкидає за сигналом', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const out = await suggestPlaces('ant', ctl.signal, 'https://api.example', async (_u, init) => {
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return respond(200, { items: [] })();
    });
    expect(out).toEqual({ status: 'failed' });
  });
});

test.describe('resolveCampsite — `?to=` приходить з адресного рядка', () => {
  test('🔴 що не схоже на slug, відсіюється ДО запиту: довге, порожнє, зі слешами, регістром, юнікодом', async () => {
    let called = 0;
    const fetchImpl = async () => {
      called++;
      return respond(200, camp())();
    };
    for (const junk of ['', '../x', 'a/b', 'UPPER', 'a'.repeat(201), '-lead', 'ünï', 'a b', '<script>', '%2e%2e']) {
      expect(await resolveCampsite(junk, 'https://api.example', fetchImpl), junk).toEqual({ status: 'unknown' });
    }
    expect(called).toBe(0);
  });

  test('знайдено: місце з підписом; 404 — «unknown»; порожня адреса API — «unavailable»', async () => {
    const found = await resolveCampsite('camping-bled', 'https://api.example', respond(200, camp()));
    expect(found.status === 'found' && found.place.label).toBe('Camping Bled (campsite), Slovenia');
    expect(await resolveCampsite('nope', 'https://api.example', respond(404, { code: 'unknown_campsite' }))).toEqual({
      status: 'unknown',
    });
    expect(await resolveCampsite('camping-bled', '', respond(200, camp()))).toEqual({ status: 'unavailable' });
  });

  test('🔴 відповідь, яка не кемпінг, — збій, а не фініш у місті з чужого slug', async () => {
    expect(await resolveCampsite('camping-bled', 'https://api.example', respond(200, good()))).toEqual({
      status: 'failed',
    });
    expect(await resolveCampsite('camping-bled', 'https://api.example', respond(200, { x: 1 }))).toEqual({
      status: 'failed',
    });
    expect(await resolveCampsite('camping-bled', 'https://api.example', respond(500, camp()))).toEqual({
      status: 'failed',
    });
  });
});

// ── Знятий з сервера: ті самі байти, що в e2e ─────────────────────────

const recorded = (name: string): { status: number; body: unknown } =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));

test.describe('відповіді сервера, знятi як є (fixtures/places-*.json)', () => {
  test('🔴 «antw»: усі записи відповіді читаються, і серед них місто, регіон і кемпінг із підписами країни словами', () => {
    const c = recorded('places-suggest-antw');
    const raw = (c.body as { items: unknown[] }).items;
    const out = readSuggestions(c.status, c.body);
    expect(out.status).toBe('found');
    if (out.status !== 'found') return;
    // Жоден запис справжньої відповіді не відсіяний: читач не мусить бути суворішим за сервер.
    expect(out.places).toHaveLength(raw.length);
    expect(out.places.map((p) => p.kind)).toEqual(expect.arrayContaining(['city', 'region', 'campsite']));
    const antwerpen = out.places.find((p) => p.name === 'Antwerpen')!;
    expect(antwerpen.label).toBe('Antwerpen, Belgium');
    const camp = out.places.find((p) => p.kind === 'campsite')!;
    expect(camp.label).toMatch(/\(campsite\), Belgium$/);
    expect(camp.slug).toMatch(/^[a-z0-9-]+$/);
  });

  test('«bled» читається, «xqzv» — «нічого», «an» (400) — збій, а не порожній список', () => {
    expect(readSuggestions(...Object.values(recorded('places-suggest-bled')) as [number, unknown]).status).toBe('found');
    const none = recorded('places-suggest-none');
    expect(readSuggestions(none.status, none.body)).toEqual({ status: 'none' });
    const short = recorded('places-suggest-short');
    expect(short.status).toBe(400);
    expect(readSuggestions(short.status, short.body)).toEqual({ status: 'failed' });
  });

  test('кемпінг за slug: знятий запис читається як кемпінг, а 404 — як невідомий', async () => {
    const ok = recorded('places-campsite-ok');
    const found = await resolveCampsite('city-camping-antwerp', 'https://api.example', respond(ok.status, ok.body));
    expect(found.status === 'found' && found.place.label).toBe('City Camping Antwerp (campsite), Belgium');
    const no = recorded('places-campsite-unknown');
    expect(no.status).toBe(404);
    expect(await resolveCampsite('no-such-camp', 'https://api.example', respond(no.status, no.body))).toEqual({
      status: 'unknown',
    });
  });
});
