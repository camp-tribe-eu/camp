/**
 * CAMP-469: зображення країни з Directus віддається з НАШОГО origin.
 *
 * Читається відданий HTML сторінки й відповідь маршруту
 * `/media/country-banner/[code]` проти підміненого `fetch` (і API, і
 * Directus). Токен у тесті — вартовий рядок із крапками (щоб «його немає
 * у відповіді» було твердженням про байти, а не про назву змінної, і щоб
 * сторож секретів не бачив у ньому облікових даних).
 *
 * Мутації цього файла й результат їх прогону — у тілі PR.
 */
import { expect, test } from '@playwright/test';
import vm from 'node:vm';

import CountryHub from '@/app/camping/[country]/page';
import { GET } from '@/app/media/country-banner/[code]/route';
import { FOREGROUND_ERROR_GUARD } from '@/components/layered-banner';
import {
  bannerFileUsable,
  fetchBannerFile,
  MAX_BYTES,
  testHooks,
} from '@/lib/cms-file';
import { rawBannerTestHooks } from '@/lib/country-banner';
import { renderAsyncComponent } from './render-component';

const MARKER = 'LEAKCHECK.camp469.marker';
const CMS = 'http://cms.camp469.invalid';
const CMS_ORIGIN = new URL(CMS).origin;
const SI_FILE = '11111111-1111-4111-8111-111111111111';
const OTHER_FILE = '22222222-2222-4222-8222-222222222222';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const ftyp = (brand: string) =>
  Uint8Array.from([0, 0, 0, 0x18, ...[...'ftyp' + brand].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
const text = (s: string) => new TextEncoder().encode(s);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const metaOf = (type: string, filesize: number | 'missing' = PNG.length) =>
  json({ data: filesize === 'missing' ? { type } : { type, filesize } });

interface World {
  /** Що API віддає для коду країни; `null` — 404. */
  banner?: Record<string, unknown> | null;
  asset?: () => Response | Promise<Response>;
  meta?: () => Response | Promise<Response>;
  cmsDown?: boolean;
  /** Directus обривається лише ПІСЛЯ N-го запиту до `/assets`. */
  assetsDownAfter?: number;
}

interface Calls {
  /** Шляхи запитів до Directus. */
  cms: Array<{ path: string; auth: string | null; signal: boolean }>;
  /** Шляхи запитів до нашого API. */
  api: string[];
}

async function inWorld<T>(w: World, run: (calls: Calls) => Promise<T>) {
  const real = globalThis.fetch;
  const env = {
    u: process.env.CMS_INTERNAL_URL,
    t: process.env.CMS_ASSET_TOKEN,
    o: process.env.CMS_FETCH_TIMEOUT_MS,
  };
  process.env.CMS_INTERNAL_URL = CMS;
  process.env.CMS_ASSET_TOKEN = MARKER;
  testHooks.reset();
  rawBannerTestHooks.reset();
  const calls: Calls = { cms: [], api: [] };
  let assetCalls = 0;
  globalThis.fetch = ((u: string, init?: RequestInit) =>
    Promise.resolve().then(() => {
      const url = new URL(String(u));
      if (url.origin === CMS_ORIGIN) {
        calls.cms.push({
          path: url.pathname + url.search,
          auth: new Headers(init?.headers).get('authorization'),
          signal: init?.signal instanceof AbortSignal,
        });
        if (w.cmsDown) throw new TypeError('connect ECONNREFUSED');
        if (url.pathname.startsWith('/assets/')) {
          assetCalls += 1;
          if (w.assetsDownAfter !== undefined && assetCalls > w.assetsDownAfter) {
            throw new TypeError('connect ECONNREFUSED');
          }
          return (w.asset ?? (() => new Response(PNG)))();
        }
        if (url.pathname.startsWith('/files/')) {
          return (w.meta ?? (() => metaOf('image/png')))();
        }
        return json({}, 404);
      }
      if (url.pathname.startsWith('/pages/camping-country/')) {
        calls.api.push(url.pathname);
        if (url.pathname.endsWith('/si')) {
          return w.banner === null
            ? json({ message: 'none' }, 404)
            : json(w.banner ?? { src: SI_FILE, alt: 'Lake Bled' });
        }
        return json({ message: 'none' }, 404);
      }
      if (url.pathname === '/spots/si/regions') {
        return json([{ region: 'Bled', slug: 'bled', spots: 12, indexable: true }]);
      }
      if (url.pathname === '/spots/map/regions') return json([]);
      return json({}, 404);
    })) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
    testHooks.reset();
    rawBannerTestHooks.reset();
    for (const [k, v] of [
      ['CMS_INTERNAL_URL', env.u],
      ['CMS_ASSET_TOKEN', env.t],
      ['CMS_FETCH_TIMEOUT_MS', env.o],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const get = (code: string, query = '', headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/media/country-banner/${code}${query}`, { headers }), {
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

/**
 * Тіла вбудованих скриптів. 🔴 БЕЗ РЕГУЛЯРКИ ПО ТЕГУ: регістр тега в HTML не
 * важить (`<SCRIPT>` виконується так само), а регулярка `<script>…</script>`
 * його не бачила б, і тест лишався б зеленим над розміткою, яку не прочитав
 * (CodeQL js/bad-tag-filter). Шукаємо за нижнім регістром копії, а вміст
 * беремо з оригіналу за тими самими зсувами.
 */
function inlineScriptBodies(html: string): string[] {
  const lower = html.toLowerCase();
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const open = lower.indexOf('<script', from);
    if (open === -1) break;
    const start = lower.indexOf('>', open);
    const close = lower.indexOf('</script', start);
    if (start === -1 || close === -1) break;
    out.push(html.slice(start + 1, close));
    from = close + 1;
  }
  return out;
}

test('сторож скриптів читає тег у будь-якому регістрі', () => {
  expect(inlineScriptBodies('<p>x</p><SCRIPT>a()</SCRIPT>')).toEqual(['a()']);
  expect(inlineScriptBodies('<ScRiPt type="x">b()</sCrIpT >')).toEqual(['b()']);
  expect(inlineScriptBodies('<script>1</script><script>2</script>')).toEqual(['1', '2']);
  expect(inlineScriptBodies('<p>без скриптів</p>')).toEqual([]);
});

const CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';


test('🔴 віддає саме файл, указаний у полі цієї країни, токеном із сервера', async () => {
  await inWorld({}, async (calls) => {
    // `?f=` намагається підмінити файл — маршрут його не читає.
    const res = await get('si', `?f=${OTHER_FILE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...PNG]);
    expect(calls.cms.map((c) => c.path)).toEqual([`/assets/${SI_FILE}`]);
    expect(calls.cms[0].auth).toBe(`Bearer ${MARKER}`);
  });
});

test('🔴 заголовки відповіді 200: nosniff, CSP «нічого», кеш не довший за добу і без immutable', async () => {
  await inWorld({}, async () => {
    const res = await get('si');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL);
    expect(res.headers.get('cache-control')).not.toContain('immutable');
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{24}"$/);
  });
});

test("🔴 прив'язка: файл, не прив'язаний до банера країни, не віддається", async () => {
  await inWorld({}, async (calls) => {
    // Країна без поля: навіть із чужим id в адресі — відмова, Directus не чіпано.
    for (const [code, q] of [
      ['at', `?f=${SI_FILE}`],
      ['at', `?f=${OTHER_FILE}`],
    ] as const) {
      expect((await get(code, q)).status, `${code}${q}`).toBe(404);
    }
    expect(calls.cms).toEqual([]);
  });
  // Поле вказує на шлях у public/ — це не файл Directus, маршрут мовчить.
  await inWorld({ banner: { src: '/banners/x.jpg', alt: '' } }, async (calls) => {
    expect((await get('si')).status).toBe(404);
    expect(calls.cms).toEqual([]);
  });
});

test('🔴 сміттєвий код відсікається ДО будь-якого походу — і в CMS, і в наше API', async () => {
  await inWorld({}, async (calls) => {
    for (const code of [OTHER_FILE, '..%2F..', 'sis', 'a', '1', '%00', 'и'.repeat(2), 'é1']) {
      expect((await get(code)).status, code).toBe(404);
    }
    expect(calls.cms).toEqual([]);
    expect(calls.api).toEqual([]);
    // Пара: код правильної форми, якого нема, ПИТАЄ API — перевірка не глуха.
    expect((await get('zz')).status).toBe(404);
    expect(calls.api).toEqual(['/pages/camping-country/zz']);
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
    // Регістр тега не рятує: вміст відкидається за байтами, не за розміткою.
    text('<SVG XMLNS="http://www.w3.org/2000/svg"><SCRIPT>1</SCRIPT></SVG>'),
    text('<?xml version="1.0"?>\n<Svg><ScRiPt>1</ScRiPt></Svg>'),
    text('<HTML><SCRIPT>alert(1)</SCRIPT></HTML>'),
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

test('🔴 завеликий файл: відмова за заголовком, навіть якщо тіло мале', async () => {
  await inWorld(
    {
      asset: () =>
        new Response(PNG, { headers: { 'content-length': String(MAX_BYTES + 1) } }),
    },
    async () => expect((await get('si')).status).toBe(404),
  );
});

test('🔴 тіло понад ліміт БЕЗ Content-Length обривається, а не читається до кінця', async () => {
  const CHUNK = 64 * 1024;
  let pulled = 0;
  await inWorld(
    {
      asset: () => {
        const chunk = new Uint8Array(CHUNK);
        chunk.set(PNG);
        pulled = 0;
        // Три ліміти тіла, без довжини: чесний обрив зупиниться біля першого.
        return new Response(
          new ReadableStream({
            pull(c) {
              if (pulled >= MAX_BYTES * 3) return c.close();
              pulled += CHUNK;
              c.enqueue(chunk);
            },
          }),
        );
      },
    },
    async () => {
      expect((await get('si')).status).toBe(404);
      expect(pulled, 'прочитано байтів').toBeLessThanOrEqual(MAX_BYTES + 2 * CHUNK);
      expect(pulled, 'прочитано хоч щось').toBeGreaterThan(MAX_BYTES);
    },
  );
});

test('🔴 Directus недоступний: маршрут — 404, сторінка — запасний банер без помилки', async () => {
  await inWorld({ cmsDown: true }, async () => {
    expect((await get('si')).status).toBe(404);
    const html = await page();
    expect(html).toContain('Campsites in Slovenia');
    expect(html).toContain('src="/banners/eu-dawn.webp"');
    expect(foregroundImgs(html)).toEqual([]);
  });
});

test('🔴 Directus завис: запит обривається таймаутом, а не висить', async () => {
  test.setTimeout(8000);
  process.env.CMS_FETCH_TIMEOUT_MS = '60';
  const hang = (init: () => AbortSignal | undefined) =>
    new Promise<Response>((_, reject) => {
      init()?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')));
    });
  const real = globalThis.fetch;
  await inWorld({}, async (calls) => {
    const inner = globalThis.fetch;
    globalThis.fetch = ((u: string, init?: RequestInit) =>
      new URL(String(u)).origin === CMS_ORIGIN ? hang(() => init?.signal ?? undefined) : inner(u, init)) as typeof fetch;
    process.env.CMS_FETCH_TIMEOUT_MS = '60';
    const t0 = Date.now();
    expect((await get('si')).status).toBe(404);
    const html = await page();
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(foregroundImgs(html)).toEqual([]);
    expect(calls.cms.every((c) => c.signal)).toBe(true);
  });
  globalThis.fetch = real;
});

test('🔴 без налаштованого токена сторінка така, як була', async () => {
  await inWorld({}, async () => {
    delete process.env.CMS_ASSET_TOKEN;
    const html = await page();
    expect(foregroundImgs(html)).toEqual([]);
  });
});

test('🔴 сторінка: тип з метаданих поза списком (зокрема SVG) не стає картинкою', async () => {
  for (const type of ['application/pdf', 'image/svg+xml', 'text/html', 'image/heic', '']) {
    await inWorld({ meta: () => metaOf(type) }, async () => {
      const html = await page();
      expect(foregroundImgs(html), type).toEqual([]);
      expect(html).toContain('Campsites in Slovenia');
    });
  }
});

test('🔴 сторінка: розмір з метаданих понад ліміт, нульовий чи відсутній — не картинка', async () => {
  for (const size of [MAX_BYTES + 1, 0, 'missing'] as const) {
    await inWorld({ meta: () => metaOf('image/png', size) }, async () => {
      expect(foregroundImgs(await page()), String(size)).toEqual([]);
    });
  }
});

test('🔴 відповідь Directus не 2xx не береться до уваги, хоч би тіло виглядало добре', async () => {
  await inWorld({ meta: () => json({ data: { type: 'image/png', filesize: 12 } }, 404) }, async () => {
    expect(foregroundImgs(await page())).toEqual([]);
  });
  await inWorld({ asset: () => new Response(PNG, { status: 403 }) }, async () => {
    expect((await get('si')).status).toBe(404);
    expect(foregroundImgs(await page())).toEqual([]);
  });
});

test('🔴 id, що не є UUID, не доходить до Directus жодною дорогою', async () => {
  await inWorld({}, async (calls) => {
    for (const id of ['../users/me', '', 'me', `${SI_FILE}/../../users`, `${SI_FILE}?x=1`]) {
      expect(await fetchBannerFile(id), id).toBeNull();
      expect(await bannerFileUsable(id), id).toBe(false);
    }
    expect(calls.cms).toEqual([]);
  });
});

test('🔴 п’ять способів, якими Directus бреше на рендері: читач бачить запасний банер, не биту картинку', async () => {
  const worlds: Array<[string, World]> = [
    ['SVG під іменем .png', { asset: () => new Response(text('<svg xmlns="http://www.w3.org/2000/svg"/>')) }],
    ['AVIF із брендом mif1', { meta: () => metaOf('image/avif'), asset: () => new Response(ftyp('mif1')) }],
    ['HEIC із типом image/jpeg', { meta: () => metaOf('image/jpeg'), asset: () => new Response(ftyp('heic')) }],
    ['403 на /assets', { asset: () => new Response('denied', { status: 403 }) }],
    ['порожній файл', { asset: () => new Response(new Uint8Array(0)) }],
  ];
  for (const [name, w] of worlds) {
    await inWorld(w, async () => {
      const html = await page();
      expect(foregroundImgs(html), name).toEqual([]);
      expect(html, name).toContain('src="/banners/eu-dawn.webp"');
      expect((await get('si')).status, name).toBe(404);
    });
  }
});

test('🔴 сторінка: зображення з Directus іде з нашого origin, без хоста CMS', async () => {
  await inWorld({}, async () => {
    const html = await page();
    const imgs = foregroundImgs(html);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain(`src="/media/country-banner/si?f=${SI_FILE}"`);
    expect(imgs[0]).toContain('alt="Lake Bled"');
    expect(html).not.toContain('camp469.invalid');
    expect(html).toContain('src="/banners/eu-dawn.webp"');
  });
});

test('🔴 запис як адреса з файлової бібліотеки теж працює, хост ігнорується', async () => {
  await inWorld(
    { banner: { src: `https://evil.example/assets/${SI_FILE}?download`, alt: '' } },
    async (calls) => {
      const res = await get('si');
      expect(res.status).toBe(200);
      expect(calls.cms.map((c) => c.path)).toEqual([`/assets/${SI_FILE}`]);
    },
  );
});

test('🔴 60 запитів із різними ?f= — один похід у Directus і один в API', async () => {
  await inWorld({}, async (calls) => {
    const res = await Promise.all(
      Array.from({ length: 60 }, (_, i) => get('si', `?f=${i}`)),
    );
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(calls.cms.filter((c) => c.path.startsWith('/assets/'))).toHaveLength(1);
    expect(calls.api).toHaveLength(1);
    // Наступні запити — з пам'яті.
    await get('si', '?f=999');
    expect(calls.cms.filter((c) => c.path.startsWith('/assets/'))).toHaveLength(1);
  });
});

test('🔴 країна без банера: 30 запитів — один похід у API; відмова Directus — один похід у CMS', async () => {
  await inWorld({}, async (calls) => {
    for (let i = 0; i < 30; i++) expect((await get('at', `?f=${i}`)).status).toBe(404);
    expect(calls.api).toEqual(['/pages/camping-country/at']);
  });
  await inWorld({ asset: () => new Response('boom', { status: 500 }) }, async (calls) => {
    for (let i = 0; i < 30; i++) expect((await get('si', `?f=${i}`)).status).toBe(404);
    expect(calls.cms.filter((c) => c.path.startsWith('/assets/'))).toHaveLength(1);
  });
});

test('🔴 ETag: збіг дає 304 без тіла, інший ETag — 200', async () => {
  await inWorld({}, async () => {
    const first = await get('si');
    const etag = first.headers.get('etag')!;
    const same = await get('si', '', { 'if-none-match': etag });
    expect(same.status).toBe(304);
    expect((await same.arrayBuffer()).byteLength).toBe(0);
    expect(same.headers.get('cache-control')).toBe(CACHE_CONTROL);
    expect((await get('si', '', { 'if-none-match': '"other"' })).status).toBe(200);
  });
});

test('🔴 Directus упав після кешу: добу віддається застарілий файл, потім відмова', async () => {
  await inWorld({ assetsDownAfter: 1 }, async () => {
    let now = 1_000_000;
    testHooks.setClock(() => now);
    expect((await get('si')).status).toBe(200);
    now += 2 * 60 * 60 * 1000; // кеш застарів, оновлення впаде
    const stale = await get('si');
    expect(stale.status).toBe(200);
    expect([...new Uint8Array(await stale.arrayBuffer())]).toEqual([...PNG]);
    now += 23 * 60 * 60 * 1000; // уже 25 годин від успіху
    expect((await get('si')).status).toBe(404);
  });
});

test('🔴 запасний шлях ПІСЛЯ рендеру: скрипт ховає рамку, коли файл не завантажився', async () => {
  await inWorld({}, async () => {
    const html = await page();
    // Скрипт є в розмітці й стоїть ДО `<img>`, бо `error` не спливає.
    expect(inlineScriptBodies(html), 'скрипту запасного шляху в розмітці немає').toContain(
      FOREGROUND_ERROR_GUARD,
    );
    expect(html.indexOf(FOREGROUND_ERROR_GUARD)).toBeLessThan(html.indexOf('<img class="ct-banner__media-img"'));

    // Виконуємо ТОЙ САМИЙ текст проти мінімального документа.
    const listeners: Array<{ type: string; fn: (e: unknown) => void; capture: boolean }> = [];
    const media = { style: { display: '' } };
    const mk = (cls: string, complete: boolean, naturalWidth: number) => ({
      tagName: 'IMG',
      complete,
      naturalWidth,
      classList: { contains: (c: string) => c === cls },
      closest: (sel: string) => (sel === '.ct-banner__media' ? media : null),
    });
    const banner = mk('ct-banner__media-img', true, 0);
    const other = mk('some-other-img', true, 0);
    let pending: unknown[] = [];
    const document = {
      addEventListener: (type: string, fn: (e: unknown) => void, capture: boolean) =>
        listeners.push({ type, fn, capture }),
      querySelectorAll: () => pending,
    };
    vm.runInNewContext(FOREGROUND_ERROR_GUARD, { document });
    const on = (type: string) => listeners.find((l) => l.type === type)!;

    expect(on('error').capture, 'error не спливає: потрібна фаза захоплення').toBe(true);
    on('error').fn({ target: other });
    expect(media.style.display, 'чужа картинка не чіпається').toBe('');
    on('error').fn({ target: banner });
    expect(media.style.display).toBe('none');

    // Помилка могла статись до слухача: перевірка на DOMContentLoaded.
    media.style.display = '';
    pending = [mk('ct-banner__media-img', true, 0)];
    on('DOMContentLoaded').fn({});
    expect(media.style.display, 'битий раніше за слухача').toBe('none');
    media.style.display = '';
    pending = [mk('ct-banner__media-img', true, 1200), mk('ct-banner__media-img', false, 0)];
    on('DOMContentLoaded').fn({});
    expect(media.style.display, 'цілу чи ще вантажену не ховаємо').toBe('');
  });
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
    expect(body).not.toContain(MARKER);
    expect(body.toLowerCase()).not.toContain('bearer');
    expect(body).not.toContain('camp469.invalid');
  }
});
