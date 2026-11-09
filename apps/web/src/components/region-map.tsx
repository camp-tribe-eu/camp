'use client';

import { useEffect, useRef, useState } from 'react';
import type { AmenityKey, SpotType } from '@/lib/api';
import { activeFilters } from '@/lib/hub-filters';
import { chunkKey, chunkUrl, type ChunkFeature } from '@/lib/map-chunks';
import { applyFilters, type MapFilterState } from '@/lib/map-filter';
import { MARKER_STROKE, UNKNOWN_COLOUR, typeColourExpression } from '@/lib/map-palette';
import { MAP_SOURCES } from '@/lib/map-sources';

/**
 * Мапа регіону на сторінці `/camping/{country}/{region}` — CAMP-452.
 *
 * Власник: «якщо ми зліва тут обираємо, то не бачимо, що фільтрується
 * внизу». Відповідь картки: мапа — ПРЕДСТАВЛЕННЯ того самого набору, що
 * й перелік, а не картинка поруч. Вона малює ВСІ кемпінги регіону й
 * підсвічує ті, що проходять поточний фільтр; решта лишається сірими
 * крапками, щоб було видно, ЩО фільтр відсіяв.
 *
 * 🔴 ТОЙ САМИЙ ФІЛЬТР, ЩО Й НА /map — `applyFilters` із `lib/map-filter.ts`,
 * над тим самим чанком `/data/spots/{country}/{slug}.geojson`, який
 * малює велика мапа (CAMP-127). Словник один: `types=`, `amenities=`,
 * `unknown=1` (CAMP-35). Це друга копія правила, яке API тримає в SQL;
 * копія прийнята в `map-filter.ts` з названою причиною, і e2e цієї
 * картки звіряє число підсвічених із `matched` API на тій самій адресі.
 *
 * 🔴 ЧИСЛО В ПІДПИСІ — ПОРАХОВАНЕ ТУТ, над тим, що намальовано, а не
 * переписане з API. Якби підпис друкував `matched` із сервера, зламана
 * підсвітка лишила б його правильним. Поки чанк не приїхав, підпис каже,
 * що підсвічуватиме, — із власного пропа `filter`, тому сторінка, яка
 * передала мапі не той запит, що переліку, видна вже у відданому HTML.
 *
 * 🔴 ЧОМУ НЕ `next/dynamic` З `ssr: false`, як у site-map-embed.tsx.
 * Тоді сервер віддавав би лише заглушку, і жоден юніт не зміг би
 * прочитати з HTML, який фільтр дістала мапа. MapLibre тягнеться до
 * `window` при імпорті, тож імпорт іде ДИНАМІЧНО всередині ефекту, а
 * сам компонент рендериться на сервері: контейнер, підпис, кредит.
 *
 * 🔴 КРЕДИТ ДВІЧІ, як на мапі кемпінгу (site-map.tsx): контрол на мапі
 * (згортається в «ⓘ» на вузькому екрані) і незгортний рядок під нею.
 * Умова ліцензії OpenFreeMap, не прикраса.
 *
 * Розміри — з теми Fuse (`assets/map.build.css`, читано з архіву
 * `fuse 1.0.1.zip` 09.11.2026):
 *
 *   .map .map__wrapper{position:relative;padding-top:59.945%}
 *                                              ≥992: padding-top:41.06%
 *   .map .map__wrapper iframe{position:absolute;top:0;left:0}
 *   .map .map__tab-content{border-radius:calc(var(--global-border-radius)*.75)}
 *
 * 59.945% — пропорція мапи у стовпчику (у теми — на телефоні), 41.06% —
 * широкої мапи (у теми — від 992px). Тут стовпчик до 992px — на всю
 * ширину, тож пропорція лишається 59.945%; широка мапа (`wide`) бере
 * 41.06%. `min-height:260px` — наше число з `campsite-media.tsx`.
 *
 * 🔴 СЕЛЕКТОР ПОЛОТНА ПОДВОЄНИЙ НАВМИСНО (`.ct-rmap__frame .ct-rmap__canvas`).
 * MapLibre додає контейнеру клас `maplibregl-map` з `position:relative`,
 * і його таблиця стилів приїжджає окремим чанком ПІСЛЯ нашої — при
 * рівній специфічності вигравала вона. Заміряно 09.11.2026 у Chromium:
 * контейнер лягав ПІД відступ рамки з висотою 0, полотно лишалось 300px
 * типового розміру, тайли не запитувались, а підпис при цьому чесно
 * казав «7 of 30» — стан мапи правильний, пікселів немає. Те саме
 * правило й та сама причина, що в `.maplibregl-ctrl-group.maplibregl-
 * ctrl-group button` у globals.css.
 */

export interface RegionMapFilter {
  types: SpotType[];
  amenities: AmenityKey[];
  includeUnknown: boolean;
}

type MapState =
  | { kind: 'loading' }
  | { kind: 'ready'; highlighted: number; total: number }
  | { kind: 'failed'; why: 'data' | 'webgl' };

/** Zoom, далі якого мапа не наближається, навіть коли в регіоні одна точка. */
const MAX_ZOOM = 13;

const isFiltering = (f: RegionMapFilter) => f.types.length > 0 || f.amenities.length > 0;

/**
 * Підпис під мапою — єдине речення про те, що на ній видно. Фільтр
 * названо словами чіпів (`filterLabel`), а не `describeQuery`: той дає
 * «Campsites» і для «paid», і для порожнього фільтра, бо так зветься тип.
 */
function legend(state: MapState, filter: RegionMapFilter, region: string): string {
  const what = activeFilters(filter)
    .map((f) => f.label)
    .join(', ');
  switch (state.kind) {
    case 'loading':
      return isFiltering(filter)
        ? `Loading the map of ${region}. Highlighted when it arrives: ${what}.`
        : `Loading the map of ${region}.`;
    case 'ready':
      return isFiltering(filter)
        ? `${state.highlighted} of ${state.total} sites in ${region} match your filter and are highlighted on the map.`
        : `${state.total} sites in ${region} on the map.`;
    case 'failed':
      return state.why === 'data'
        ? `The map of ${region} could not be loaded; the list below is complete.`
        : `The map needs WebGL, which this browser did not give us; the list below is complete.`;
  }
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const REGION_MAP_CSS = `
.ct-rmap__frame{position:relative;overflow:hidden;padding-top:59.945%;min-height:260px;border-radius:calc(var(--r,16px) * .75);border:1px solid var(--color-line-2);background-color:var(--color-surface-2)}
.ct-rmap--wide .ct-rmap__frame{padding-top:41.06%}
.ct-rmap__frame .ct-rmap__canvas{position:absolute;top:0;left:0;width:100%;height:100%}
.ct-rmap__legend{margin-top:8px;font-size:.875rem;line-height:1.5;color:var(--color-ink-2)}
.ct-rmap__credit{margin-top:4px;font-size:.75rem;color:var(--color-ink-3)}
`;

export default function RegionMap({
  country,
  slug,
  region,
  filter,
  wide = false,
}: {
  /** ISO-код країни, як у шляху сторінки. */
  country: string;
  /** Slug регіону — той самий, що в адресі сторінки й у чанку мапи. */
  slug: string;
  /** Назва регіону для підпису. */
  region: string;
  filter: RegionMapFilter;
  /** На всю ширину (сторінки без текстового стовпчика поруч). */
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<MapState>({ kind: 'loading' });

  // 🔴 КЛЮЧ, А НЕ ОБʼЄКТ, у залежностях — як `outlineKey` у site-map.tsx:
  // обʼєкт новий на кожному рендері батька, рядок однаковий, доки
  // однаковий фільтр.
  const filterKey = JSON.stringify([filter.types, filter.amenities, filter.includeUnknown]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    let map: import('maplibre-gl').Map | null = null;
    setState({ kind: 'loading' });

    (async () => {
      const [{ Map: MapLibreMap, Popup, AttributionControl, NavigationControl, setWorkerUrl }] =
        await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
      const res = await fetch(chunkUrl(chunkKey({ country, slug })));
      if (!res.ok) throw new Error(`chunk ${res.status}`);
      const geo = (await res.json()) as { features: ChunkFeature[] };
      if (cancelled) return;

      // 🔴 Той самий фільтр, що на /map. `overnight` вимкнено, як і в API
      // регіону (`parseRegionQuery`): на цій сторінці немає лічильника,
      // який чесно сказав би, скільки невідомих.
      const mapFilter: MapFilterState = { ...filter, overnight: false };
      const { shown } = applyFilters(geo.features, mapFilter);
      const lit = new Set(shown.map((f) => f.properties.slug));
      const features = geo.features.map((f) => ({
        ...f,
        properties: { ...f.properties, m: lit.has(f.properties.slug) },
      }));

      // 🔴 Без цього рядка мапи немає — див. site-map.tsx і
      // scripts/copy-maplibre-worker.mjs.
      setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const f of features) {
        const [lon, lat] = f.geometry.coordinates;
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
      const hasBounds = features.length > 0 && Number.isFinite(west);

      try {
        map = new MapLibreMap({
          container: el,
          style: MAP_SOURCES[0].style,
          center: hasBounds ? [(west + east) / 2, (south + north) / 2] : [10, 50],
          zoom: 6,
          attributionControl: false,
        });
      } catch {
        // Без WebGL MapLibre кидає ще на конструкторі (site-map.tsx).
        setState({ kind: 'failed', why: 'webgl' });
        return;
      }
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      // Без `customAttribution`: стиль OpenFreeMap несе власний кредит.
      map.addControl(new AttributionControl({ compact: true }));

      let loaded = false;
      map.on('error', () => {
        // До `load` помилка означає стиль або воркер — мапи не буде;
        // після — одну плитку, з якою мапа живе (site-map.tsx).
        if (!loaded) setState({ kind: 'failed', why: 'webgl' });
      });
      map.on('load', () => {
        if (!map || cancelled) return;
        loaded = true;
        map.addSource('region', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        });
        // Відсіяні — сірі й менші; ті, що пройшли фільтр, — у кольорі
        // свого типу з темним обводом (`map-palette.ts`), радіус за зумом
        // як у маркерів великої мапи (campsite-map.tsx).
        map.addLayer({
          id: 'region-dim',
          type: 'circle',
          source: 'region',
          filter: ['!', ['get', 'm']],
          paint: {
            'circle-radius': 4,
            'circle-color': UNKNOWN_COLOUR,
            'circle-opacity': 0.45,
            'circle-stroke-width': 0.5,
            'circle-stroke-color': MARKER_STROKE,
          },
        });
        map.addLayer({
          id: 'region-lit',
          type: 'circle',
          source: 'region',
          filter: ['get', 'm'],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 7],
            'circle-color': typeColourExpression() as never,
            'circle-opacity': 0.9,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': MARKER_STROKE,
          },
        });
        if (hasBounds) {
          map.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            { padding: 28, animate: false, maxZoom: MAX_ZOOM },
          );
        }
        map.on('click', 'region-lit', (e) => {
          const f = e.features?.[0];
          if (!f || !map) return;
          const p = f.properties as { name?: string | null; href?: string | null; type?: string };
          // `setDOMContent`, не `setHTML`: назва приходить із даних.
          const node = document.createElement('div');
          const title = document.createElement('strong');
          title.textContent = p.name ?? 'Unnamed site';
          node.append(title);
          if (p.href) {
            const a = document.createElement('a');
            a.href = p.href;
            a.textContent = 'Open the campsite';
            a.className = 'block mt-1 underline';
            node.append(a);
          }
          new Popup({ closeButton: true }).setLngLat(e.lngLat).setDOMContent(node).addTo(map);
        });
        map.on('mouseenter', 'region-lit', () => {
          if (map) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'region-lit', () => {
          if (map) map.getCanvas().style.cursor = '';
        });
        // 🔴 Підпис рахується над тим, що додано в джерело мапи, а не над
        // відповіддю API: зламана підсвітка міняє це число.
        setState({ kind: 'ready', highlighted: lit.size, total: features.length });
      });
    })().catch(() => {
      if (!cancelled) setState({ kind: 'failed', why: 'data' });
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
    // `filter` навмисно замінено на `filterKey` — див. коментар біля ключа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, slug, filterKey]);

  return (
    <div className={wide ? 'ct-rmap ct-rmap--wide' : 'ct-rmap'}>
      <style href="ct-rmap" precedence="ct-components">
        {REGION_MAP_CSS}
      </style>
      <div className="ct-rmap__frame">
        <div
          ref={box}
          className="ct-rmap__canvas"
          data-testid="region-map"
          data-map-state={state.kind}
          data-highlighted={state.kind === 'ready' ? state.highlighted : undefined}
          data-total={state.kind === 'ready' ? state.total : undefined}
        />
      </div>
      <p className="ct-rmap__legend" data-testid="region-map-legend">
        {legend(state, filter, region)}
      </p>
      <p className="ct-rmap__credit" data-testid="region-map-credit">
        Map: <span className="whitespace-nowrap">OpenFreeMap © OpenMapTiles</span>, data
        from OpenStreetMap.
      </p>
    </div>
  );
}
