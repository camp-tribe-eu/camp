'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_SOURCES } from '@/lib/map-sources';
import type { DisturbanceMarker } from '@/lib/disturbance';
import {
  DISTURBANCE_PIN_COLOUR,
  fitBox,
  pinAttributes,
  SITE_ZOOM,
} from '@/lib/site-map-view';
import { TYPE_COLOUR } from '@/lib/map-palette';
import {
  outlineBounds,
  OUTLINE_FILL_OPACITY,
  OUTLINE_LINE_WIDTH,
  type Outline,
} from '@/lib/outline';

/**
 * Мапа ОДНОГО кемпінгу (CAMP-344).
 *
 * 🔴 ЧОМУ НЕ `campsite-map.tsx`. Той компонент — мапа всієї Європи:
 * 2600 рядків, кластеризація, фільтри, шари пожеж і посухи, перемикач
 * стилів. Сторінці кемпінгу з усього цього не потрібне ніщо: їй треба
 * показати одне місце й те, що довкола. Підключити великий означало б
 * везти на кожну з 63 159 сторінок код, 95% якого там мертвий.
 *
 * Плитки — те саме джерело, що й у великої мапи (`MAP_SOURCES[0]`), і
 * атрибуція та сама: контрол на мапі + рядок під нею. Це умова ліцензії,
 * не прикраса.
 */

// 🔴 БЕЗ ЦЬОГО РЯДКА МАПИ НЕМАЄ, І Я ЦЕ ЩОЙНО ПРОЙШОВ. Компонент
// мовчки падав у запасний стан, бо воркер MapLibre не завантажувався:
// «Worker failed to load». Репозиторій знав відповідь давно — і
// `campsite-map.tsx:176`, і `route-map.tsx:41` роблять те саме, а
// `scripts/copy-maplibre-worker.mjs` кладе файл у `public/maplibre/`
// ще на `predev`. Я просто не подивився, як це зроблено поруч.
//
// Область модуля, тож виконується до того, як збудується перша мапа.
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const ZOOM = SITE_ZOOM;


export default function SiteMap({
  lat,
  lon,
  type,
  label,
  outline = null,
  disturbance = [],
}: {
  lat: number;
  lon: number;
  type: string;
  label: string;
  outline?: Outline | null;
  /** CAMP-502: where the nearest motorway / railway line / airport comes closest. */
  disturbance?: readonly DisturbanceMarker[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // CAMP-502: which pin's note is open (its kind), and the pins' elements so
  // `aria-expanded` can follow it.
  const [openKind, setOpenKind] = useState<string | null>(null);
  const pinEls = useRef(new Map<string, HTMLElement>());

  // 🔴 КЛЮЧ, А НЕ ОБʼЄКТ, У ЗАЛЕЖНОСТЯХ ЕФЕКТУ.
  //
  // `outline` приходить розібраним обʼєктом, тобто новим за посиланням
  // на кожному рендері батька. У масиві залежностей це означає: ефект
  // перезапускається без причини, `map.remove()` зносить мапу й вона
  // будується наново — на контурі, який не змінився ні на кому.
  //
  // Рядок порівнюється за ЗНАЧЕННЯМ, тож перезапуск стається тоді й
  // лише тоді, коли контур справді інший.
  //
  // Чесно про межі цього твердження: я НЕ спостерігав тут такого збою.
  // Симптом, через який я сюди поліз — порожні атрибути при живому
  // канвасі — виявився закешованим `module not found` у dev-сервері
  // після переїзду файла між worktree; після перезапуску все три
  // атрибути на місці. Ключ лишається як запобіжник, а не як ліки від
  // доведеної хвороби.
  const outlineKey = outline ? JSON.stringify(outline) : '';
  const disturbanceKey = JSON.stringify(disturbance);

  useEffect(() => {
    if (!box.current) return;
    // 🔴 СТАРІ СИГНАЛИ ЗНІМАЮТЬСЯ ПЕРЕД ПОБУДОВОЮ. `map.remove()`
    // атрибутів не чіпає, а React при клієнтському переході лишає
    // той самий вузол: без цього кемпінг БЕЗ обрису успадкував би
    // `data-outline-layer="true"` від попереднього. Назвала рецензія
    // PR #292; e2e цього не бачить, бо ходить `page.goto()`.
    box.current.removeAttribute('data-outline-layer');
    box.current.removeAttribute('data-map-loaded');
    box.current.removeAttribute('data-ready');
    // Нова точка — новий шанс. Без цього рядка `failed` з попереднього
    // кемпінгу перенісся б на наступний.
    setFailed(false);
    let map: MapLibreMap | null = null;
    try {
      map = new MapLibreMap({
        container: box.current,
        style: MAP_SOURCES[0].style,
        center: [lon, lat],
        zoom: ZOOM,
        // 🔴 Контрол кредиту додається нижче явно, як у `route-map.tsx` і
        // `campsite-map.tsx`; тут його вимкнено, щоб не вийшло двох.
        // Раніше його не було зовсім: мапа показувала чужі плитки без
        // кредиту НА мапі, а рядок під нею (`campsite-media.tsx`) тримала
        // сама сторінка. Кредит — умова ліцензії OpenFreeMap, і вона не
        // має залежати від того, який батьківський компонент пам'ятає
        // дописати підпис. Контрол на вузькому екрані згортається у «ⓘ»:
        // саме тому рядок під мапою ЛИШАЄТЬСЯ — це друга, незгортна
        // половина тієї самої гарантії.
        attributionControl: false,
        // Сторінка кемпінгу — не мапа для подорожі по Європі. Крутити її
        // далеко немає сенсу, а випадкове відлітання на інший край
        // континенту читається як поломка.
        maxBounds: [
          [lon - 0.5, lat - 0.35],
          [lon + 0.5, lat + 0.35],
        ],
      });
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      // 🔴 Без `customAttribution`: стилі OpenFreeMap вже несуть власний
      // кредит, і MapLibre ДОДАЄ наш до нього, а не замінює — кредит
      // вийшов би двічі в одному рядку (так було на `route-map.tsx`).
      map.addControl(new AttributionControl({ compact: true }));

      // 🔴 CAMP-352. Обрис ділянки — лише там, де він Є в OpenStreetMap.
      //
      // Заміряно 19.10.2026 по 63 159 кемпінгах: контур має 55,1%, у
      // 31,1% це крапка, у 13,9% немає навіть osm_ref. Намальована «межа»
      // там, де її не знає першоджерело, була б вигадкою на сторінці,
      // яка пояснює, чому ми не показуємо чужих фото.
      const drawn = outline;
      // 🔴 ОБРОБНИК РЕЄСТРУЄТЬСЯ ЗАВЖДИ, І АТРИБУТ ЗАВЖДИ ДІСТАЄ
      // ЗНАЧЕННЯ — 'true' або 'false', ніколи «немає».
      //
      // Попередня редакція реєструвала його лише за наявності
      // контуру, а заборона в e2e спиралась на ВІДСУТНІСТЬ атрибута
      // й на те, що якір `data-map-loaded` із сусіднього обробника
      // спрацює пізніше. Це трималось на порядку реєстрації
      // слухачів MapLibre — ніде не заявленому. Перенести сусідній
      // обробник вище, і заборона стала б порожньою, не почервонівши
      // жодного разу. Назвала рецензія PR #292.
      //
      // Визначене значення знімає і це, і застарілий атрибут при
      // клієнтському переході «з обрисом → без»: ефект перезапускається
      // й переписує його, а не лишає чужу правду від попереднього кемпінгу.
      map.on('load', () => {
        if (!map) return;
        if (!drawn) {
          box.current?.setAttribute('data-outline-layer', 'false');
          return;
        }
        {
          map.addSource('site-outline', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: drawn },
          });
          const colour = TYPE_COLOUR[type] ?? TYPE_COLOUR.paid;
          map.addLayer({
            id: 'site-outline-fill',
            type: 'fill',
            source: 'site-outline',
            paint: { 'fill-color': colour, 'fill-opacity': OUTLINE_FILL_OPACITY },
          });
          map.addLayer({
            id: 'site-outline-line',
            type: 'line',
            source: 'site-outline',
            paint: { 'line-color': colour, 'line-width': OUTLINE_LINE_WIDTH },
          });
          // Кадр по ділянці, а не по точці: інакше велика площа вилазить
          // за край і сторінка читається як поломка.
          const bounds = outlineBounds(drawn);
          // 🔴 maxZoom: ZOOM — кадруємо лише НАЗОВНІ. Без нього мала
          // ділянка затягує мапу на z19+, і обіцянка сусіднього
          // коментаря («видно ділянку і дорогу до неї, але ще читається
          // село») перестає триматись на 55% сторінок. Знайшла рецензія.
          //
          // 🔴 `return`, А НЕ `if (bounds) { … }`: порожня геометрія
          // (`coordinates: []`) проходить `addSource` і `addLayer`, не
          // малює нічого, і попередня редакція все одно ставила атрибут
          // — зелено над порожнечею. Межі порожньої геометрії це `null`,
          // тож тепер такий випадок до сигналу просто не доходить.
          // Назвала рецензія.
          if (!bounds) {
            box.current?.setAttribute('data-outline-layer', 'false');
            return;
          }
          // 🔴 The outline, the campsite's point and the NEAR pins only: a
          // distant airport must not shrink the site to a dot (site-map-view.ts).
          map.fitBounds(fitBox(lat, lon, bounds, disturbance) ?? bounds, {
            padding: 28,
            animate: false,
            maxZoom: ZOOM,
          });
          box.current?.setAttribute('data-zoom', map.getZoom().toFixed(2));
          // 🔴 СИГНАЛ ПРО СТАН МАПИ, А НЕ ПРО ПІКСЕЛІ.
          //
          // Перша редакція ставила його через `queryRenderedFeatures` по
          // нашому шару — і на firefox-desktop атрибут не зʼявився
          // жодного разу за 61 опитування (30 с). Рендер залежить від
          // рушія й від того, чи є на раннері апаратний WebGL; будувати
          // на ньому перевірку означає червоніти на правильному коді.
          // Я це вже знав — годиною раніше з тієї ж причини відмовився
          // спиратись на `data-ready` — і все одно вступив удруге.
          //
          // Питання, яке справді треба поставити, інше: чи дійшов проп
          // до `addSource`. Це стан, однаковий у всіх рушіях, і саме
          // його вбиває мутація `const drawn = outline` → `null`. Чи
          // намалювався піксель — відповідальність MapLibre.
          // 🔴 ПИТАЄМО МАПУ, А НЕ ВЛАСНУ ПАМʼЯТЬ. Рецензія PR #292
          // довела мутацією, що `fill-opacity: 0` + `line-width: 0`
          // лишає обрис цілком невидимим при зелених тестах: шари
          // існують, джерело додане, і перевірка «шар є» це
          // підтверджує. Вона підтвердила б і порожнечу.
          //
          // `getPaintProperty` читає те, що мапа СПРАВДІ застосувала.
          // Це все ще стан, а не піксель: рушій і WebGL тут ні до
          // чого, тож firefox не почервоніє на правильному коді —
          // помилка, якої я в цій картці припустився вже двічі.
          const visible =
            !!map.getLayer('site-outline-fill') &&
            !!map.getLayer('site-outline-line') &&
            Number(map.getPaintProperty('site-outline-fill', 'fill-opacity')) > 0 &&
            Number(map.getPaintProperty('site-outline-line', 'line-width')) > 0;
          box.current?.setAttribute(
            'data-outline-layer',
            visible ? 'true' : 'false',
          );
        }
      });
      new Marker({ color: TYPE_COLOUR[type] ?? TYPE_COLOUR.paid })
        .setLngLat([lon, lat])
        .addTo(map);
      // CAMP-502: a pin where each possible disturbance comes closest. The words
      // are the CMS's (`map-label`); the pin says "possible", never "noise".
      // CAMP-502: a pin where each object comes closest. 🔴 A pin is a
      // BUTTON: pressing it (tap, click, Enter, Space) opens the note with its
      // label and the sentence that we did not measure noise. A `title` alone
      // does not exist on a touch screen.
      const pins = pinEls.current;
      pins.clear();
      setOpenKind(null);
      for (const d of disturbance) {
        const el = document.createElement('div');
        for (const [k, v] of Object.entries(pinAttributes(d, false)))
          el.setAttribute(k, v);
        el.textContent = '!';
        el.style.cssText =
          `width:28px;height:28px;border-radius:50%;background:${DISTURBANCE_PIN_COLOUR};color:#fff;` +
          'font:700 15px/24px sans-serif;text-align:center;border:2px solid #fff;' +
          'box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer';
        const toggle = () =>
          setOpenKind((was) => (was === d.kind ? null : d.kind));
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          toggle();
        });
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            ev.stopPropagation();
            toggle();
          } else if (ev.key === 'Escape') setOpenKind(null);
        });
        pins.set(d.kind, el);
        new Marker({ element: el }).setLngLat([d.lon, d.lat]).addTo(map);
      }
      // Before the style loads, so the first frame is already the right one.
      // With an outline the `load` handler fits again, outline included.
      const first = fitBox(lat, lon, null, disturbance);
      if (first)
        map.fitBounds(first, { padding: 48, animate: false, maxZoom: ZOOM });
      box.current.setAttribute('data-zoom', map.getZoom().toFixed(2));
      let ready = false;
      map.on('load', () => {
        ready = true;
        // 🔴 ЯКІР ДЛЯ ЗАБОРОН. Перевірка «обрису НЕ намальовано» нічого
        // не варта, якщо зробити її до того, як обрис МІГ БИ зʼявитись:
        // шар додається у власному обробнику `load`, тобто помітно
        // пізніше за появу контейнера. Рецензія показала, що мутація
        // «малюємо завжди» пережила б таку заборону.
        //
        // Цей атрибут каже «стиль завантажено», тобто подію, а не
        // піксель — однаково в усіх рушіях. На відміну від `data-ready`,
        // який залежить від намальованого й на частині сторінок не
        // зʼявляється зовсім (перевірено на кемпінгу в Мальті).
        box.current?.setAttribute('data-map-loaded', 'true');
      });
      map.on('error', () => {
        if (!ready) setFailed(true);
      });

      // 🔴 `data-ready` СТАВИТЬСЯ ЗА НАМАЛЬОВАНИМ, А НЕ ЗА ПОДІЄЮ, і це
      // єдиний спосіб помітити найтихішу поломку цієї бібліотеки.
      //
      // Якщо не покликати `setWorkerUrl`, MapLibre шукає воркер за
      // `import.meta.url`, тобто всередині чанка Next, отримує 404 у
      // вигляді HTML і відмовляється його виконувати. Наслідок описаний
      // у `campsite-map.tsx:160`: мапа зʼявляється, контроли працюють,
      // помилки до `load` немає — і ЖОДЕН векторний шар не малюється,
      // бо розбір векторних плиток це вся робота воркера.
      //
      // Канвас при цьому існує. Подія `error` не спрацьовує. Тобто
      // перевірка «чи є канвас» і перевірка «чи не показано запасний
      // текст» проходять ОБИДВІ — я це заміряв мутацією, і сторож
      // лишився зеленим.
      //
      // `queryRenderedFeatures()` питає інше: чи щось справді
      // намальовано. Порожня мапа цього задовольнити не може.
      map.on('idle', () => {
        if (!map) return;
        if (map.queryRenderedFeatures().length > 0) {
          box.current?.setAttribute('data-ready', 'true');
        }
      });
    } catch {
      // 🔴 Без WebGL MapLibre кидає ще на конструкторі. Сторінка
      // кемпінгу не має через це зникати — на раннері CI, у старому
      // браузері чи при вимкненому апаратному прискоренні лишається
      // текст із координатами, і це теж відповідь.
      setFailed(true);
    }
    return () => map?.remove();
    // `outline` навмисно замінено на `outlineKey`: обʼєкт у залежностях
    // перестворював би мапу на кожному ререндері батька — див. коментар
    // біля оголошення ключа. Значення читається із замикання, і воно те
    // саме, бо ключ міняється рівно тоді, коли міняється обʼєкт.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, type, outlineKey, disturbanceKey]);

  useEffect(() => {
    for (const [kind, el] of pinEls.current)
      el.setAttribute('aria-expanded', kind === openKind ? 'true' : 'false');
  }, [openKind]);
  const openPin = disturbance.find((d) => d.kind === openKind) ?? null;

  // 🔴 КОНТЕЙНЕР РЕНДЕРИТЬСЯ ЗАВЖДИ, А ЗАПАСНИЙ ТЕКСТ ЛЯГАЄ ПОВЕРХ.
  // Перша редакція повертала при `failed` зовсім іншу гілку — БЕЗ `ref`.
  // Наслідок знайшла рецензія і він гірший, ніж здається: `failed`
  // ніде не скидався, тож ефект при зміні координат виходив одразу на
  // `if (!box.current) return`, і мапи не було вже НІКОЛИ. Одна помилка
  // стилю чи воркера на першому кемпінгу — і всі наступні переходи
  // всередині сайту показували «потрібен WebGL» у браузері, де WebGL є.
  //
  // `role` немає навмисно: велика мапа репозиторію його теж не ставить.
  // Перша редакція мала `role="img"`, а це листова роль — нащадки
  // стають презентаційними, і дві кнопки зуму лишаються в таб-порядку
  // без ролі й без імені для читача екрана.
  return (
    <div className="relative h-full w-full">
      <div ref={box} data-testid="site-map" className="h-full w-full rounded-card" />
      {/* CAMP-502: the pressed pin's words. Top-left, clear of the zoom
          control (top-right) and of the attribution (bottom). Both sentences
          come from the CMS through the marker; nothing is typed here. */}
      {openPin && !failed && (
        <div
          id="disturbance-note"
          data-testid="disturbance-note"
          data-kind={openPin.kind}
          role="status"
          // On a phone the map is 258 px tall and the note takes much of it:
          // a tap on the note puts it away (the pin and Escape do too).
          onClick={() => setOpenKind(null)}
          className="absolute left-2 top-2 z-10 max-w-[calc(100%-4rem)] rounded-card border border-line-2 bg-surface p-2 text-xs leading-snug text-ink shadow-md md:p-3 md:text-sm"
        >
          <p className="font-semibold">{openPin.label}</p>
          <p className="mt-1 text-ink-2">{openPin.caveat}</p>
        </div>
      )}
      {failed && (
        <div
          data-testid="site-map-fallback"
          className="absolute inset-0 flex items-center justify-center rounded-card border border-line-2 bg-surface-2 p-6 text-center text-sm text-ink-2"
        >
          The map needs WebGL, which this browser did not give us.
          <br />
          {label} is at {lat.toFixed(5)}, {lon.toFixed(5)}.
        </div>
      )}
    </div>
  );
}
