import { test, expect, type Page } from './api-request';
import { hasWebGl } from '../map-ready';

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
    const webgl = await hasWebGl(page);

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
    // Дванадцяти досить — але не «за побудовою», як тут стояло раніше.
    // Фікстура закріплює ПРЕДИКАТ (`isSecondarySql`, звірено тестом в
    // `apps/api/src/spots/outline.spec.ts`), а от ПОРЯДОК вона не
    // закріплює: він походить з `allPublishable()` —
    // `ORDER BY s.country, s.region, s.slug`. Заміряно рецензією на
    // поточній фікстурі: обрисований рядок у вікно потрапляє.
    //
    // 🔴 Отже це ДОПУЩЕННЯ, не гарантія. Якщо `allPublishable()` колись
    // змінить порядок, тест упаде — і впаде правильно, з повідомленням
    // нижче, яке каже «гілка недосяжна». Назву причини треба читати як
    // «або обрису справді немає, або рядок виїхав за вікно», і перше,
    // що тут робити, — надрукувати порядок, а не правити фікстуру.
    //
    // 🔴 Число тут раніше стояло хибне — «72 із 73». Рецензія
    // перерахувала: у `ci-seed.sql` 73 INSERT у `camping_spots`, але
    // один помічений `missing_since` (рядок 162) і в індекс не
    // потрапляє. Тож індексованих 72, із них БЕЗ обрису 71. Я рахував
    // вихід фікстури, а не те, що з неї справді віддається.
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

    // 🔴 Без WebGL мапи не буде взагалі — див. `hasWebGl`. Питаємо ОДИН
    // раз: у межах прогону браузер не міняється.
    const webgl = await hasWebGl(page);

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
        //
        // 🔴 АЛЕ ЛИШЕ ТАМ, ДЕ МАПА ВЗАГАЛІ МОЖЕ ІСНУВАТИ. На firefox без
        // WebGL атрибута не буде за побудовою, і вимога його означала б
        // червоніти на правильній поведінці — я на це вже наступав двічі
        // в цій самій картці.
        //
        // Де WebGL немає, стверджуємо не мовчання, а ПРИСУТНІСТЬ
        // запасного тексту: інакше гілка перетворилась би на пропуск,
        // який нічого не доводить.
        const box = page.getByTestId('site-map');
        if (webgl) {
          await expect(box).toHaveAttribute('data-outline-layer', 'true', {
            timeout: 30_000,
          });
        } else {
          await expect(
            page.getByTestId('site-map-fallback'),
            'без WebGL мусить лишатись текст із координатами',
          ).toHaveCount(1);
        }
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
        // 🔴 СПЕРШУ ДОЧЕКАТИСЬ, ПОТІМ ЗАБОРОНЯТИ. Попередня редакція
        // перевіряла відсутність атрибута одразу після `toBeVisible()`,
        // а ставиться він у обробнику `load` — помітно пізніше. Тобто
        // заборона встигала пройти ДО того, як заборонене могло
        // статись, і мутація «малюємо завжди» її пережила б. Знайшла
        // рецензія.
        //
        // `data-map-loaded` — подія завантаження стилю, не піксель, тож
        // надійна в усіх рушіях.
        // 🔴 ЧЕКАЄМО ВИЗНАЧЕНОГО ЗНАЧЕННЯ, А НЕ ВІДСУТНОСТІ. Заборона
        // «атрибута немає» мовчазно порожніє, щойно він перестає
        // зʼявлятись із будь-якої причини — а причина не мусить бути
        // дефектом обрису: вистачило б іншого порядку реєстрації
        // слухачів MapLibre, ніде не заявленого. `'false'` такого
        // задовольнити не може: його ставить той самий обробник, що
        // поставив би `'true'`.
        const box = page.getByTestId('site-map');
        if (webgl) {
          await expect(box).toHaveAttribute('data-outline-layer', 'false', {
            timeout: 30_000,
          });
          await expect(page.getByTestId('site-map-fallback')).toHaveCount(0);
        } else {
          await expect(
            page.getByTestId('site-map-fallback'),
            'без WebGL мусить лишатись текст із координатами',
          ).toHaveCount(1);
        }

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
  // 🔴 CAMP-453: ТУТ БУВ ТЕСТ «ДВІ КОЛОНКИ РІВНО ТАМ, ДЕ ЛІВА НЕ ПОРОЖНЯ»,
  // і його ПРЕМІСА зникла разом із розкладкою. Ліва колонка була то
  // порожньою, то ні (опис і контакти є не скрізь), тож сітка вмикала дві
  // колонки умовно. Тепер там завжди стоять назва, ключові факти й
  // зручності, і колонок завжди дві — на кожній сторінці. Це доводить
  // `campsite-pdp.spec.ts` («дві колонки на кожній сторінці»), а тест про
  // умовну розкладку тримав би правило, якого вже немає.

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
