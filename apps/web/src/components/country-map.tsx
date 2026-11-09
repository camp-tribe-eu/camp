'use client';

import { useEffect, useRef, useState } from 'react';
import type { RegionSummary } from '@/lib/map-chunks';
import { MAP_SOURCES } from '@/lib/map-sources';

/**
 * Мапа країни на `/camping/{country}` — CAMP-474.
 *
 * Власник, 09.11.2026: «нам точно треба мати і мапу і банер … банер може
 * бути на горі а мапа трохи нижче на сторінці».
 *
 * 🔴 ЦЕ МАПА РЕГІОНІВ, А НЕ КЕМПІНГІВ, І ЦЕ ЗАМІР, А НЕ СМАК. Сторінка
 * країни — це перелік регіонів; мапа має показувати те саме, що перелік.
 * Намалювати всі точки тут коштувало б: Франція — 103 чанки й 17 937
 * точок у них (заміряно на проді 09.11.2026, `/data/spots/index.json`),
 * тобто кілька мегабайтів перед першим пікселем. Та сама причина, через
 * яку велика мапа взагалі розпалась на чанки (CAMP-127): читач платить
 * байтами.
 *
 * 🔴 ДАНІ ПРИЇЖДЖАЮТЬ ПРОПОМ ІЗ СЕРВЕРА, не запитом із браузера. Сторінка
 * статична, рядки індексу вона вже має, і жодного додаткового запиту тут
 * немає. Побічний наслідок, заради якого це й зроблено так: число в
 * підписі видно у ВІДДАНОМУ HTML, тож юніт може прочитати, скільки
 * регіонів сторінка дала мапі, не піднімаючи браузера.
 *
 * 🔴 ПЛОЩА КРУЖЕЧКА ПРОПОРЦІЙНА КІЛЬКОСТІ, тобто радіус — корінь. Радіус
 * «на око» робить регіон на 600 кемпінгів у 600/26 ≈ 23 рази товщим за
 * медіанний замість ≈ 4,8, і читач бачить не ті пропорції, які є.
 *
 * Розміри, кредит і подвоєний селектор полотна — з `region-map.tsx`,
 * причини там самі (тема Fuse `assets/map.build.css`; таблиця MapLibre
 * приїжджає після нашої й виграє при рівній специфічності).
 */

type MapState = 'loading' | 'ready' | 'failed';

/** Далі цього не наближаємось: мапа країни, а не вулиці. */
const MAX_ZOOM = 9;

/** Колір кружечка — синій ліній мапи в темі. */
const CIRCLE_COLOUR = '#2f6f9f';

/** Радіус у пікселях для регіону з `count` кемпінгів. */
export function circleRadius(count: number, max: number): number {
  if (max <= 0) return MIN_RADIUS;
  const r = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(count / max);
  return Math.round(r * 10) / 10;
}
const MIN_RADIUS = 5;
const MAX_RADIUS = 22;

/**
 * 🔴 ПІДПИС РАХУЄТЬСЯ З ТОГО, ЩО СТОРІНКА ДАЛА МАПІ, і тому однаковий до
 * й після малювання: обидва числа прийшли пропом, а не з мапи. Якби він
 * чекав на `load`, сторінка з порожнім пропом виглядала б у HTML так
 * само, як сторінка, що просто ще вантажиться.
 *
 * Єдина гілка, де речення інше, — та, де мапи не буде взагалі.
 */
function legend(state: MapState, country: string, regions: number, spots: number): string {
  if (state === 'failed') {
    return 'The map needs WebGL, which this browser did not give us; the regions are listed below.';
  }
  return (
    `${regions} ${regions === 1 ? 'region' : 'regions'} of ${country} on the map, ` +
    `${spots} campsites between them. A larger circle is a region with more of ` +
    `them; select one to open it.`
  );
}

// Не експортується: тест має читати відданий HTML, а не цю константу.
const COUNTRY_MAP_CSS = `
.ct-cmap__frame{position:relative;overflow:hidden;padding-top:59.945%;min-height:260px;border-radius:calc(var(--r,16px) * .75);border:1px solid var(--color-line-2);background-color:var(--color-surface-2)}
@media(min-width:992px){.ct-cmap__frame{padding-top:41.06%}}
.ct-cmap__frame .ct-cmap__canvas{position:absolute;top:0;left:0;width:100%;height:100%}
.ct-cmap__legend{margin-top:8px;font-size:.875rem;line-height:1.5;color:var(--color-ink-2)}
.ct-cmap__credit{margin-top:4px;font-size:.75rem;color:var(--color-ink-2)}
`;

export interface CountryMapProps {
  /** ISO-код країни, як у шляху сторінки. */
  country: string;
  /** Назва країни для підпису. */
  countryName: string;
  /** Рядки індексу мапи, вже звужені до цієї країни. */
  regions: RegionSummary[];
}

/**
 * 🔴 ПОРОЖНІЙ ВИПАДОК ВІДСІЧЕНО ДО ГАЧКІВ, І ЦЕ НЕ СТИЛЬ. Рамка мапи без
 * жодної точки гірша за її відсутність: читач бачить сіру діру й робить
 * висновок, що зламалось. А технічно — гачок не можна поставити під
 * умову, тож перевірка мусить стояти ВИЩЕ за компонент, який їх має.
 * Побічний наслідок, заради якого це й зроблено так: цей випадок тепер
 * можна перевірити викликом функції, без рендера й без React.
 */
export default function CountryMap(props: CountryMapProps) {
  if (props.regions.length === 0) return null;
  return <CountryMapCanvas {...props} />;
}

function CountryMapCanvas({ country, countryName, regions }: CountryMapProps) {
  const box = useRef<HTMLDivElement>(null);
  // 🔴 Стан стартує з того, що СЕРВЕР уже знає: скільки регіонів і
  // кемпінгів піде на мапу. Якби він стартував порожнім, сторінка, яка
  // дала мапі не ті рядки, виглядала б у HTML однаково з правильною.
  const spots = regions.reduce((n, r) => n + r.count, 0);
  const [state, setState] = useState<MapState>('loading');

  // Ключ, а не масив: обʼєкт новий на кожному рендері батька.
  const key = `${country}:${regions.length}:${spots}`;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    let map: import('maplibre-gl').Map | null = null;
    setState('loading');

    (async () => {
      const [{ Map: MapLibreMap, AttributionControl, NavigationControl, setWorkerUrl }] =
        await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
      if (cancelled) return;

      // 🔴 Без цього рядка мапи немає — див. site-map.tsx і
      // scripts/copy-maplibre-worker.mjs.
      setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

      const max = Math.max(...regions.map((r) => r.count));
      const features = regions.map((r) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [r.lon, r.lat] },
        properties: {
          name: r.region ?? 'No region',
          href: r.region ? `/camping/${country.toLowerCase()}/${r.slug}` : null,
          count: r.count,
          radius: circleRadius(r.count, max),
        },
      }));

      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const r of regions) {
        if (r.minLon < west) west = r.minLon;
        if (r.maxLon > east) east = r.maxLon;
        if (r.minLat < south) south = r.minLat;
        if (r.maxLat > north) north = r.maxLat;
      }

      try {
        map = new MapLibreMap({
          container: el,
          style: MAP_SOURCES[0].style,
          center: [(west + east) / 2, (south + north) / 2],
          zoom: 4,
          attributionControl: false,
        });
      } catch {
        // Без WebGL MapLibre кидає ще на конструкторі (site-map.tsx).
        setState('failed');
        return;
      }
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
      // Без `customAttribution`: стиль OpenFreeMap несе власний кредит.
      map.addControl(new AttributionControl({ compact: true }));

      let loaded = false;
      map.on('error', () => {
        if (!loaded) setState('failed');
      });
      map.on('load', () => {
        if (!map || cancelled) return;
        loaded = true;
        map.addSource('regions', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        });
        map.addLayer({
          id: 'region-circles',
          type: 'circle',
          source: 'regions',
          paint: {
            'circle-radius': ['get', 'radius'],
            'circle-color': CIRCLE_COLOUR,
            'circle-opacity': 0.75,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
          },
        });
        map.addLayer({
          id: 'region-labels',
          type: 'symbol',
          source: 'regions',
          layout: {
            'text-field': ['to-string', ['get', 'count']],
            'text-size': 11,
            'text-allow-overlap': false,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': CIRCLE_COLOUR, 'text-halo-width': 1 },
        });
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 28, animate: false, maxZoom: MAX_ZOOM },
        );
        map.on('click', 'region-circles', (e) => {
          const p = e.features?.[0]?.properties as
            | { name?: string; href?: string | null }
            | undefined;
          if (p?.href) window.location.assign(p.href);
        });
        map.on('mouseenter', 'region-circles', () => {
          if (map) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'region-circles', () => {
          if (map) map.getCanvas().style.cursor = '';
        });
        setState('ready');
      });
    })().catch(() => {
      // 🔴 Тут не `data`: даних мапа не вантажить — вони вже в пропі.
      // Усе, що може не доїхати, це сам MapLibre або його стиль.
      if (!cancelled) setState('failed');
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
    // `regions` навмисно замінено на `key` — див. коментар біля ключа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="ct-cmap">
      <style href="ct-cmap" precedence="ct-components">
        {COUNTRY_MAP_CSS}
      </style>
      <div className="ct-cmap__frame">
        <div
          ref={box}
          className="ct-cmap__canvas"
          data-testid="country-map"
          data-map-state={state}
          data-regions={regions.length}
          data-spots={spots}
        />
      </div>
      <p className="ct-cmap__legend" data-testid="country-map-legend">
        {legend(state, countryName, regions.length, spots)}
      </p>
      <p className="ct-cmap__credit" data-testid="country-map-credit">
        Map: <span className="whitespace-nowrap">OpenFreeMap © OpenMapTiles</span>, data
        from OpenStreetMap.
      </p>
    </div>
  );
}
