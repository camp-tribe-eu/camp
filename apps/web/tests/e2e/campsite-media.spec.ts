import { test, expect, type Page } from '@playwright/test';

/**
 * CAMP-344 — медіаслот сторінки кемпінгу.
 *
 * 🔴 ГОЛОВНЕ ТУТ — ПУНКТ 4 КАРТКИ: «жодного стокового чи згенерованого
 * зображення: мутація „підставити ілюстрацію замість мапи“ мусить
 * червонити перевірку». Макет (`Design/01-campsite.html`) формулює це
 * як обіцянку читачеві: «We don't publish pictures we haven't verified.
 * No stock shots, no AI-generated scenery».
 *
 * Обіцянка, яку ніщо не стереже, тримається рівно до першого, хто
 * захоче «щоб не було порожньо».
 */

/**
 * Перший кемпінг із індексу, відкритий у браузері.
 *
 * 🔴 ВІДМОВА І ПОРОЖНЕЧА — ДВА РІЗНІ ПРОВАЛИ, І ЇХ ТРЕБА НАЗИВАТИ
 * ПО-РІЗНОМУ. Перша редакція читала `.json()` одразу й падала на
 * `spots.length === undefined` зі словами «API не віддав жодного
 * кемпінгу». Насправді API віддавав `429 ThrottlerException` — тобто
 * повідомлення вказувало на дані, а причина була в лімітах. Я витратив
 * на це окремий прогін.
 */
async function anySpot(page: Page, request: Page['request']) {
  const res = await request.get(
    `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/spots/index`,
  );
  expect(res.status(), `API відмовив: ${res.status()} ${res.statusText()}`).toBe(200);
  const body: unknown = await res.json();
  expect(
    Array.isArray(body),
    `API віддав не масив: ${JSON.stringify(body).slice(0, 120)}`,
  ).toBe(true);
  const spots = body as { country: string; region: string; slug: string }[];
  expect(spots.length, 'індекс кемпінгів порожній').toBeGreaterThan(0);
  const s = spots[0];
  await page.goto(`/camping/${s.country}/${s.region}/${s.slug}`);
  return s;
}

test.describe('🔴 CAMP-344 — що стоїть у медіаслоті', () => {
  test('без фото показано мапу, і в слоті НЕМАЄ жодного зображення', async ({
    page,
    request,
  }) => {
    await anySpot(page, request);

    const media = page.getByTestId('campsite-media');
    await expect(media).toBeVisible();

    // Сьогодні фото немає в жодного кемпінгу (канал власника CAMP-233/232
    // і реєстр прав CAMP-342 ще не зроблені), тож очікуваний стан — мапа.
    await expect(media).toHaveAttribute('data-kind', 'map');

    // 🔴 ТУТ БУЛО «(site-map) + (site-map-fallback) === 1», І ЦЕ
    // ПОГОДЖУВАЛОСЬ ІЗ БАГОМ, ЯКИЙ МАЛО ЛОВИТИ. `data-kind="map"` пише
    // та сама гілка коду, тож прибери `setWorkerUrl` із `site-map.tsx` —
    // мапа падає в запасний текст, а всі чотири тести лишаються
    // зеленими. Слова `canvas` у файлі не було жодного разу.
    //
    // Чесна форма питає те, чого запасний текст задовольнити НЕ МОЖЕ:
    // намальований канвас. А щоб це не стало хибною тривогою там, де
    // WebGL справді немає (headless Firefox на раннері без GPU — див.
    // `map.spec.ts:189`), питання ставиться ДИФЕРЕНЦІЙНО: якщо браузер
    // уміє WebGL2, канвас мусить бути.
    const webgl = await page.evaluate(() => {
      try {
        return !!document.createElement('canvas').getContext('webgl2');
      } catch {
        return false;
      }
    });

    if (webgl) {
      // 🔴 НЕ «ЧИ Є КАНВАС». Заміряно мутацією: прибери `setWorkerUrl` —
      // канвас є, помилки немає, запасного тексту немає, і перевірка на
      // канвас проходить. А векторних шарів при цьому НЕМАЄ жодного:
      // без воркера нікому розбирати плитки.
      //
      // `data-ready` ставиться компонентом лише тоді, коли
      // `queryRenderedFeatures()` повертає хоч щось — тобто коли на
      // мапі справді намальовано. Порожня мапа цього не задовольнить.
      await expect(
        media.locator('[data-testid="site-map"][data-ready="true"]'),
        'мапа не намалювала жодного обʼєкта — найімовірніше не доїхав воркер',
      ).toHaveCount(1, { timeout: 20_000 });
      await expect(
        media.getByTestId('site-map-fallback'),
        'запасний текст показано там, де WebGL є',
      ).toHaveCount(0);
    } else {
      await expect(
        media.getByTestId('site-map-fallback'),
        'без WebGL мусить лишатись текст із координатами',
      ).toHaveCount(1);
    }

    // 🔴 І ВЛАСТИВІСТЬ, А НЕ ПЕРЕЛІК ЗАБОРОНЕНИХ ТЕГІВ. Рахувати самі
    // `img` замало: інлайновий `svg`, `background-image` чи намальована
    // поверх картинка пройшли б. Питання формулюється навпаки — ЩО тут
    // узагалі має право малювати: канвас мапи і значки її власних
    // контролів. Будь-що інше, чим би воно не було, це зображення, якого
    // ми не перевіряли.
    const stray = await media.evaluate((root) => {
      const out: string[] = [];
      for (const el of root.querySelectorAll('*')) {
        const tag = el.tagName.toLowerCase();
        const inControl = !!el.closest('.maplibregl-ctrl, .maplibregl-marker');
        if ((tag === 'img' || tag === 'picture' || tag === 'svg') && !inControl) {
          out.push(tag);
        }
        if (tag === 'canvas' && !el.closest('[data-testid="site-map"]')) {
          out.push('canvas поза мапою');
        }
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none' && !inControl) out.push(`background-image на ${tag}`);
      }
      return out;
    });
    expect(stray, 'у слоті є зображення, якого там бути не має').toEqual([]);
  });

  test('🔴 обидві гілки підпису справді проходяться', async ({ page, request }) => {
    // 🔴 ПОПЕРЕДНЯ РЕДАКЦІЯ ЦЬОГО ТЕСТУ БРАЛА ПЕРШИЙ-ЛІПШИЙ КЕМПІНГ — і
    // через це гілка «контур є» не виконувалась ЖОДНОГО разу: у фікстурі
    // обрис має один рядок, а `spots[0]` це інший. Тест був зелений і
    // нічого не перевіряв. Знайшла рецензія PR #292.
    //
    // Тепер тест сам знаходить обидва випадки й падає, якщо котрогось
    // немає — тобто стереже ще й досяжність гілок у фікстурі.
    const base = process.env.API_BASE_URL ?? 'http://localhost:3001';
    const index = await request.get(`${base}/spots/index`);
    expect(index.status()).toBe(200);
    const spots = (await index.json()) as {
      country: string;
      region: string;
      slug: string;
    }[];
    expect(spots.length, 'індекс кемпінгів порожній').toBeGreaterThan(0);

    let withOutline: (typeof spots)[number] | null = null;
    let without: (typeof spots)[number] | null = null;
    // 🔴 МЕЖА 12, А НЕ 40, І ВІДМОВА НЕ МОВЧИТЬ.
    //
    // Перша редакція робила до 41 запиту й писала `if (status !== 200)
    // continue` — тобто 429 від обмежувача (ліміт 120/хв) або 500 виходили
    // назовні як «у фікстурі жоден кемпінг не має обрису». Це вказувало б
    // на фікстуру там, де ламаються ліміти, — рівно та помилка, про яку
    // попереджає заголовок цього ж файла. Знайшла рецензія.
    //
    // Дванадцяти досить: обрисований кемпінг у фікстурі перший в індексі
    // за побудовою (`ci-seed-page-outline.sql` бере той самий предикат і
    // той самий порядок), а рядок без обрису є серед перших за будь-якого
    // розкладу — їх 72 із 73.
    for (const s of spots.slice(0, 12)) {
      if (withOutline && without) break;
      const detail = await request.get(
        `${base}/spots/${s.country}/${s.region}/${s.slug}`,
      );
      expect(
        detail.status(),
        `API відмовив на ${s.country}/${s.region}/${s.slug}: ${detail.status()} — ` +
          'це поломка API чи обмежувача, а НЕ порожня фікстура',
      ).toBe(200);
      const body = (await detail.json()) as { spot?: { outline?: unknown } };
      const has = body.spot?.outline != null;
      if (has && !withOutline) withOutline = s;
      if (!has && !without) without = s;
    }

    expect(
      withOutline,
      'у фікстурі жоден кемпінг не має обрису — гілка «контур є» недосяжна',
    ).not.toBeNull();
    expect(
      without,
      'у фікстурі кожен кемпінг має обрис — гілка «контуру немає» недосяжна',
    ).not.toBeNull();

    for (const [spot, expected] of [
      [withOutline!, 'yes'],
      [without!, 'no'],
    ] as const) {
      await page.goto(
        `/camping/${spot.country}/${spot.region}/${spot.slug}`,
      );
      const caption = page.getByTestId('campsite-media').locator('figcaption');

      // Умова ліцензії: атрибуція мусить бути видимою на самій сторінці.
      await expect(caption).toContainText('OpenStreetMap');
      await expect(caption).toHaveAttribute('data-outline', expected);

      if (expected === 'yes') {
        // Обрис є в першоджерелі — підпис мусить це сказати.
        await expect(caption).toContainText(/outline/i);

        // 🔴 І ОБРИС МУСИТЬ БУТИ НАМАЛЬОВАНИЙ, А НЕ ЛИШЕ ОБІЦЯНИЙ.
        //
        // Третя ланка ланцюга — `SiteMap` отримав проп, але чи дійшов він
        // до `addSource`? Рецензія довела, що ні: мутація `const drawn =
        // outline` → `null` лишала всі 1 830 тестів зеленими, бо підпис
        // береться з пропа, а не з мапи.
        //
        // Питаємо саме НАМАЛЬОВАНЕ: `queryRenderedFeatures` на нашому
        // шарі. Порожня мапа цього задовольнити не може, і механізм уже
        // є — компонент тим самим викликом ставить `data-ready`.
        const box = page.getByTestId('site-map');
        await expect(box).toHaveAttribute('data-outline-drawn', 'true', {
          timeout: 30_000,
        });
      } else {
        // 🔴 І ЗВОРОТНИЙ БІК: там, де обрису немає, шар не має зʼявитись.
        // Без цього твердження «малюємо завжди» пройшло б половину
        // перевірки й провалилось би лише на підписі.
        //
        // 🔴 АЛЕ МОВЧАННЯ ЗАДОВОЛЬНЯЄ ЗАБОРОНУ. Якщо мапа взагалі не
        // піднялась, атрибута немає тривіально — і перевірка зеленіє над
        // мертвим компонентом. Тому поруч стоїть позитивне твердження:
        // контейнер існує й запасний текст НЕ показано, тобто MapLibre
        // таки стартував.
        //
        // На `data-ready` тут НЕ спираємось навмисно: 20.10.2026 я
        // відкрив сторінку кемпінгу на Мальті й мапа лишилась порожньою
        // понад 20 секунд, тобто цей атрибут не зʼявляється на частині
        // реальних сторінок. Вимагати його означало б червоніти на
        // правильній поведінці цієї перевірки.
        await expect(page.getByTestId('site-map')).toBeVisible();
        await expect(page.getByTestId('site-map-fallback')).toHaveCount(0);
        await expect(
          page.getByTestId('site-map'),
        ).not.toHaveAttribute('data-outline-drawn', 'true');

        // 🔴 А тут його немає, і обіцяти його означало б збрехати саме
        // на тій сторінці, яка пояснює, чому ми не показуємо чужих фото.
        // Заміряно 19.10.2026: обрис є у 55,1% кемпінгів, у 31,1% це
        // вузол, у 13,9% немає навіть osm_ref.
        await expect(caption).not.toContainText(/outline/i);
      }
    }
  });
});

test.describe('🔴 CAMP-344 — розкладка', () => {
  /**
   * 🔴 ТУТ БУЛО ПОРІВНЯННЯ ШИРИН ДВОХ ДОРІЖОК — І ОДНА З НИХ БУЛА
   * ПОРОЖНЯ. Рецензія заміряла: у фікстурі CI опис має один рядок із 73,
   * а `spots[0]` не має ні опису, ні контактів. Тобто тест «доводив
   * розкладку» на сторінці, де ліва колонка — 426 px пустки.
   *
   * Тепер перевіряється ВЛАСТИВІСТЬ, яка мусить триматись на кожній
   * сторінці: дві колонки рівно тоді, коли в лівій є що показати, і
   * медіа в правій ширше за опис. Де показувати нічого — одна колонка
   * на всю ширину, і це не деградація, а правильний вигляд.
   */
  test('дві колонки рівно там, де ліва не порожня', async ({ page, request }) => {
    const res = await request.get(
      `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/spots/index`,
    );
    expect(res.status(), `API відмовив: ${res.status()}`).toBe(200);
    const spots = (await res.json()) as { country: string; region: string; slug: string }[];
    expect(Array.isArray(spots) && spots.length > 0, 'індекс порожній').toBe(true);

    await page.setViewportSize({ width: 1280, height: 900 });

    // 🔴 ПОШУК ЗАПИТАМИ, ЗАМІР БРАУЗЕРОМ — І ЦЕ ВИПРАВЛЕННЯ ПО СУТІ,
    // А НЕ ПРИСКОРЕННЯ ЗАРАДИ ЧИСЛА.
    //
    // Перша редакція ходила браузером по ВІСІМДЕСЯТИ сторінках, доки не
    // трапиться по одній кожного виду. Доки сторінка кемпінгу була
    // легкою, це минало; CAMP-344 поклав на кожну WebGL-мапу, і на
    // найповільнішому рушії тест вичерпав навіть новий 90-секундний
    // бюджет (CI 20.10.2026, webkit-desktop).
    //
    // Але браузер тут потрібен рівно для двох речей: обчислених доріжок
    // сітки й ширин. А `data-columns` — серверна розмітка, і її видно
    // звичайним запитом, без рушія, без гідратації й без мапи.
    //
    // Тож спершу знаходимо по одному слагу кожного виду запитами, а
    // потім навігуємо браузером РІВНО ДВІЧІ. Жодне твердження нижче не
    // послаблене: ті самі перевірки, на тих самих двох сторінках.
    const found: Record<string, string | null> = { one: null, two: null };
    let probed = 0;
    for (const s of spots.slice(0, 80)) {
      if (found.one && found.two) break;
      probed += 1;
      const path = `/camping/${s.country}/${s.region}/${s.slug}`;
      const html = await (await request.get(path)).text();
      const m = /data-testid="campsite-hero"[^>]*data-columns="(one|two)"/.exec(html)
        ?? /data-columns="(one|two)"[^>]*data-testid="campsite-hero"/.exec(html);
      expect(m, `${s.slug}: у HTML немає блоку медіа й опису`).toBeTruthy();
      const kind = m![1];
      if (!found[kind]) found[kind] = path;
    }

    // 🔴 Пара до всього нижче: обидві гілки мусять знайтись, інакше
    // половина правила ніколи не перевірялась і тест це приховав.
    expect(
      found.one,
      `з ${probed} оглянутих сторінок жодної без опису й контактів`,
    ).toBeTruthy();
    expect(
      found.two,
      `з ${probed} оглянутих сторінок жодної з описом або контактами`,
    ).toBeTruthy();

    for (const [kind, path] of Object.entries(found) as [string, string][]) {
      await page.goto(path);
      const hero = page.getByTestId('campsite-hero');
      await expect(hero).toHaveAttribute('data-columns', kind);

      const m = await page.evaluate(() => {
        const grid = document.querySelector('[data-testid="campsite-hero"]') as HTMLElement;
        const media = document.querySelector('[data-testid="campsite-media"]')!;
        const kids = [...grid.children] as HTMLElement[];
        return {
          tracks: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          mediaWidth: media.getBoundingClientRect().width,
          gridWidth: grid.getBoundingClientRect().width,
          widths: kids.map((k) => k.getBoundingClientRect().width),
          mediaLast: kids[kids.length - 1].contains(media),
        };
      });

      if (kind === 'two') {
        expect(m.tracks, `${path}: дві колонки, а доріжок ${m.tracks}`).toBe(2);
        expect(m.mediaLast, `${path}: медіа не в правій колонці`).toBe(true);
        expect(
          m.widths[1] > m.widths[0],
          `${path}: медіа ${Math.round(m.widths[1])} не ширше за опис ${Math.round(m.widths[0])}`,
        ).toBe(true);
      } else {
        expect(m.tracks, `${path}: одна колонка, а доріжок ${m.tracks}`).toBe(1);
        // 🔴 Без опису мапа займає ВСЮ ширину. Якщо вона лишиться
        // вузькою, поруч буде та сама пустка, лише без сітки.
        expect(
          m.mediaWidth / m.gridWidth,
          `${path}: медіа займає ${Math.round((100 * m.mediaWidth) / m.gridWidth)}% ширини`,
        ).toBeGreaterThan(0.95);
      }
    }
  });

  test('на телефоні одна колонка, і медіа не займає перший екран', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await anySpot(page, request);

    const m = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="campsite-media"]')!;
      const grid = document.querySelector('[data-testid="campsite-hero"]') as HTMLElement;
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        height: el.getBoundingClientRect().height,
        viewport: window.innerHeight,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      };
    });

    expect(m.columns, 'на телефоні більше ніж одна колонка').toBe(1);
    // 🔴 Картка: «медіа НЕ займає перший екран цілком».
    expect(
      m.height / m.viewport,
      `медіа займає ${Math.round((100 * m.height) / m.viewport)}% екрана`,
    ).toBeLessThan(0.5);
    expect(m.scrollW, 'горизонтальна прокрутка на 375 px').toBeLessThanOrEqual(m.clientW);
  });
});
