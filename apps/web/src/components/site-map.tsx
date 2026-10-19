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
    } catch {
      // 🔴 Без WebGL MapLibre кидає ще на конструкторі. Сторінка
      // кемпінгу не має через це зникати — на раннері CI, у старому
      // браузері чи при вимкненому апаратному прискоренні лишається
      // текст із координатами, і це теж відповідь.
      setFailed(true);
    }
    return () => map?.remove();
  }, [lat, lon, type]);

  if (failed) {
    return (
      <div
        data-testid="site-map-fallback"
        className="flex h-full w-full items-center justify-center rounded-card border border-line-2 bg-surface-2 p-6 text-center text-sm text-ink-2"
      >
        The map needs WebGL, which this browser did not give us.
        <br />
        {label} is at {lat.toFixed(5)}, {lon.toFixed(5)}.
      </div>
    );
  }

  return (
    <div
      ref={box}
      data-testid="site-map"
      aria-label={`Map showing ${label}`}
      role="img"
      className="h-full w-full rounded-card"
    />
  );
}
