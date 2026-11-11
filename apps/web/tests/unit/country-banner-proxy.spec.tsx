/**
 * CAMP-469: зображення країни з Directus віддається з НАШОГО origin.
 *
 * Читається відданий HTML сторінки й відповідь маршруту
 * `/media/country-banner/[code]` проти підміненого `fetch` (і API, і
 * Directus). Токен у тесті — вартовий рядок, щоб «його немає у відповіді»
 * було твердженням про байти, а не про назву змінної.
 *
 * 🔴 МУТАЦІЇ, ЯКІ ЦЕЙ ФАЙЛ МУСИТЬ ЧЕРВОНИТИ (прогнано, вивід у PR):
 *   1. маршрут бере id із `?f=` замість поля країни      → «прив'язка»
 *   2. маршрут не питає поле, а йде за id із коду        → «прив'язка»
 *   3. зняти `catch` у `cms()`                           → «Directus недоступний»
 *   4. зняти перевірку типу за вмістом (`sniffImage`)    → «не-зображення»
 *   5. тип відповіді брати від Directus                  → «тип за вмістом»
 *   6. зняти ліміт довжини в `fetchBannerFile`           → «завеликий»
 *   7. зняти перевірку метаданих на рендері              → «сторінка: не-зображення»
 *   8. 🔴 просочити токен у заголовок відповіді           → «токена немає»
 *   9. 🔴 просочити токен у розмітку сторінки             → «токена немає»
 */
import { expect, test } from '@playwright/test';

import CountryHub from '@/app/camping/[country]/page';
import { GET } from '@/app/media/country-banner/[code]/route';
import { MAX_BYTES } from '@/lib/cms-file';
import { renderAsyncComponent } from './render-component';

const TOKEN = 'SENTINEL-cms-token-7f3a91c2e8d4';
const CMS = 'http://cms.camp469.invalid';
const SI_FILE = '11111111-1111-4111-8111-111111111111';
const OTHER_FILE = '22222222-2222-4222-8222-222222222222';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const text = (s: string) => new TextEncoder().encode(s);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

interface World {
  /** Що API віддає для коду країни. */
  banner?: Record<string, unknown>;
  /** Відповідь Directus на `/assets/<id>`. */
  asset?: () => Response;
  /** Метадані Directus на `/files/<id>`. */
  meta?: () => Response;
  /** Directus кидає на кожному запиті. */
  cmsDown?: boolean;
}

interface Call {
  path: string;
  auth: string | null;
}

async function inWorld<T>(w: World, run: (calls: Call[]) => Promise<T>) {
  const real = globalThis.fetch;
  const env = { u: process.env.CMS_INTERNAL_URL, t: process.env.CMS_ASSET_TOKEN };
  process.env.CMS_INTERNAL_URL = CMS;
  process.env.CMS_ASSET_TOKEN = TOKEN;
  const calls: Call[] = [];
  globalThis.fetch = ((u: string, init?: RequestInit) =>
    Promise.resolve().then(() => {
      const url = String(u);
      if (url.startsWith(CMS)) {
        calls.push({
          path: url.slice(CMS.length),
          auth: new Headers(init?.headers).get('authorization'),
        });
        if (w.cmsDown) throw new TypeError('connect ECONNREFUSED');
        if (url.includes('/assets/')) return (w.asset ?? (() => new Response(PNG)))();
        if (url.includes('/files/')) {
          return (
            w.meta ??
            (() => json({ data: { type: 'image/png', filesize: PNG.length } }))
          )();
        }
        return json({}, 404);
      }
      if (url.endsWith('/pages/camping-country/si')) {
        return json(w.banner ?? { src: SI_FILE, alt: 'Lake Bled' });
      }
      if (url.endsWith('/spots/si/regions')) {
        return json([{ region: 'Bled', slug: 'bled', spots: 12, indexable: true }]);
      }
      if (url.endsWith('/spots/map/regions')) return json([]);
      return json({}, 404);
    })) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
    if (env.u === undefined) delete process.env.CMS_INTERNAL_URL;
    else process.env.CMS_INTERNAL_URL = env.u;
    if (env.t === undefined) delete process.env.CMS_ASSET_TOKEN;
    else process.env.CMS_ASSET_TOKEN = env.t;
  }
}

const get = (code: string, query = '') =>
  GET(new Request(`http://localhost/media/country-banner/${code}${query}`), {
    params: Promise.resolve({ code }),
  });

const page = () =>
  renderAsyncComponent(CountryHub, { params: Promise.resolve({ country: 'si' }) });

const foregroundImgs = (html: string) =>
  html.match(/<img\b[^>]*class="ct-banner__media-img"[^>]*>/g) ?? [];

/** Усе, що читач міг би отримати від відповіді: статус, заголовки, тіло. */
async function wire(res: Response): Promise<string> {
  const head = [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
  return `${res.status}\n${head}\n${Buffer.from(await res.arrayBuffer()).toString('latin1')}`;
}

test('🔴 віддає саме файл, указаний у полі цієї країни, токеном із сервера', async () => {
  await inWorld({}, async (calls) => {
    // `?f=` намагається підмінити файл — маршрут його не читає.
    const res = await get('si', `?f=${OTHER_FILE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...PNG]);
    expect(calls.map((c) => c.path)).toEqual([`/assets/${SI_FILE}`]);
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`);
    expect(res.headers.get('cache-control')).toContain('s-maxage=');
  });
});

test('🔴 прив\'язка: файл, не прив\'язаний до банера країни, не віддається', async () => {
  await inWorld({}, async (calls) => {
    // Країна без поля: навіть із чужим id в адресі — відмова, Directus не чіпано.
    for (const [code, q] of [
      ['at', `?f=${SI_FILE}`],
      ['at', `?f=${OTHER_FILE}`],
      [OTHER_FILE, ''], // «id» замість коду
      ['..%2F..', ''],
      ['sis', ''],
    ] as const) {
      const res = await get(code, q);
      expect(res.status, `${code}${q}`).toBe(404);
    }
    expect(calls).toEqual([]);
  });
  // Поле вказує на шлях у public/ — це не файл Directus, маршрут мовчить.
  await inWorld({ banner: { src: '/banners/x.jpg', alt: '' } }, async (calls) => {
    expect((await get('si')).status).toBe(404);
    expect(calls).toEqual([]);
  });
});

test('🔴 тип відповіді — за вмістом, а не за тим, що сказав Directus', async () => {
  await inWorld(
    { asset: () => new Response(JPEG, { headers: { 'content-type': 'image/png' } }) },
    async () => {
      const res = await get('si');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
    },
  );
});

test('🔴 не-зображення — відмова, хоч би Directus клявся, що це PNG', async () => {
  for (const body of [
    text('<html><script>alert(1)</script></html>'),
    text('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
    text('%PDF-1.7'),
    new Uint8Array(0),
  ]) {
    await inWorld(
      { asset: () => new Response(body, { headers: { 'content-type': 'image/png' } }) },
      async () => {
        expect((await get('si')).status, new TextDecoder().decode(body)).toBe(404);
      },
    );
  }
});

test('🔴 завеликий файл — відмова: і за заголовком, і за фактичною довжиною', async () => {
  await inWorld(
    {
      asset: () =>
        new Response(PNG, { headers: { 'content-length': String(MAX_BYTES + 1) } }),
    },
    async () => expect((await get('si')).status).toBe(404),
  );
  const big = new Uint8Array(MAX_BYTES + 1);
  big.set(PNG);
  await inWorld({ asset: () => new Response(big) }, async () => {
    expect((await get('si')).status).toBe(404);
  });
});

test('🔴 Directus недоступний: маршрут — 404, сторінка — запасний банер без помилки', async () => {
  await inWorld({ cmsDown: true }, async () => {
    expect((await get('si')).status).toBe(404);
    const html = await page();
    expect(html).toContain('Campsites in Slovenia');
    expect(html).toContain('src="/banners/eu-dawn.svg"');
    expect(foregroundImgs(html)).toEqual([]);
  });
});

test('🔴 без налаштованого токена сторінка така, як була', async () => {
  const real = globalThis.fetch;
  const saved = { ...process.env };
  delete process.env.CMS_ASSET_TOKEN;
  delete process.env.CMS_INTERNAL_URL;
  try {
    await inWorld({}, async () => {
      delete process.env.CMS_ASSET_TOKEN;
      const html = await page();
      expect(foregroundImgs(html)).toEqual([]);
    });
  } finally {
    globalThis.fetch = real;
    Object.assign(process.env, saved);
  }
});

test('🔴 сторінка: файл, що не є зображенням (за метаданими), не стає картинкою', async () => {
  await inWorld(
    { meta: () => json({ data: { type: 'application/pdf', filesize: 100 } }) },
    async () => {
      const html = await page();
      expect(foregroundImgs(html)).toEqual([]);
      expect(html).toContain('Campsites in Slovenia');
    },
  );
});

test('🔴 сторінка: зображення з Directus іде з нашого origin, без хоста CMS', async () => {
  await inWorld({}, async () => {
    const html = await page();
    const imgs = foregroundImgs(html);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain(`src="/media/country-banner/si?f=${SI_FILE}"`);
    expect(imgs[0]).toContain('alt="Lake Bled"');
    expect(html).not.toContain('camp469.invalid');
    expect(html).toContain('src="/banners/eu-dawn.svg"');
  });
});

test('🔴 запис як адреса з файлової бібліотеки теж працює, хост ігнорується', async () => {
  await inWorld(
    { banner: { src: `https://evil.example/assets/${SI_FILE}?download`, alt: '' } },
    async (calls) => {
      const res = await get('si');
      expect(res.status).toBe(200);
      // Ходили лише на свій CMS, а не на хост із поля.
      expect(calls.every((c) => !c.path.includes('evil'))).toBe(true);
      expect(calls.map((c) => c.path)).toEqual([`/assets/${SI_FILE}`]);
    },
  );
});

test('🔴 токена немає у відповіді: ні в успішній, ні в жодній відмові, ні в розмітці сторінки', async () => {
  const seen: string[] = [];
  await inWorld({}, async () => {
    seen.push(await wire(await get('si')));
    seen.push(await wire(await get('at')));
    seen.push(await page());
  });
  for (const w of [
    { cmsDown: true },
    { asset: () => new Response(text('<html>'), { status: 200 }) },
    { asset: () => new Response('denied', { status: 403 }) },
  ] as World[]) {
    await inWorld(w, async () => {
      seen.push(await wire(await get('si')));
      seen.push(await page());
    });
  }
  expect(seen.length).toBeGreaterThan(8);
  for (const body of seen) {
    expect(body).not.toContain(TOKEN);
    expect(body.toLowerCase()).not.toContain('bearer');
    expect(body).not.toContain('camp469.invalid');
  }
});
