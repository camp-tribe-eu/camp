'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_SOURCES } from '@/lib/map-sources';
import { TYPE_COLOUR } from '@/lib/map-palette';

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
 * атрибуція та сама. Це умова ліцензії, не прикраса.
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

/** Zoom, на якому видно ділянку і дорогу до неї, але ще читається село. */
const ZOOM = 15;

export default function SiteMap({
  lat,
  lon,
  type,
  label,
}: {
  lat: number;
  lon: number;
  type: string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!box.current) return;
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
        // 🔴 Своя атрибуція під мапою, а не контрол: на вузькому екрані
        // контрол згортається у «ⓘ», і умова ліцензії перестає бути
        // виконаною для того, хто його не натисне.
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
      new Marker({ color: TYPE_COLOUR[type] ?? TYPE_COLOUR.paid })
        .setLngLat([lon, lat])
        .addTo(map);
      // 🔴 ВІДКАТ ЛИШЕ ДО ЗАВАНТАЖЕННЯ, А НЕ НА БУДЬ-ЯКУ ПОМИЛКУ.
      // Перша редакція ставила `failed` на кожну подію `error` — а
      // MapLibre шле її і за одну плитку, що не приїхала. Мапа,
      // побудована й робоча, зникала б від однієї мережевої гикавки, і
      // читач бачив би «немає WebGL» там, де WebGL є.
      //
      // До `load` помилка означає стиль або воркер, тобто мапи не буде
      // взагалі. Після — означає плитку, і з цим мапа живе.
      let ready = false;
      map.on('load', () => {
        ready = true;
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
        if (map && map.queryRenderedFeatures().length > 0) {
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
  }, [lat, lon, type]);

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
