/**
 * CAMP-352. Обрис ділянки — геометрія й тільки геометрія.
 *
 * 🔴 ЖИВЕ ОКРЕМО ВІД `site-map.tsx` НЕ ЗАРАДИ ОХАЙНОСТІ. Той модуль тягне
 * MapLibre, а MapLibre дотягується до `window` і до WebGL-канвасу В
 * МОМЕНТ ІМПОРТУ — тож тест, що просто імпортує його, падає ще до першої
 * перевірки. Чисту функцію, яку треба перевіряти, не можна тримати за
 * такими дверима. Саме на це я й наступив, написавши тест.
 */

/** Геометрія, як її віддає `ST_AsGeoJSON` з колонки MultiPolygon. */
export type Outline =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/**
 * Межі обрису — щоб ділянка вміщалась у кадр, а не вилазила за край.
 *
 * 🔴 Обходимо вершини РЕКУРСИВНО, а не на фіксовану глибину: Polygon це
 * масив кілець, MultiPolygon — масив полігонів, і колонка оголошена
 * MultiPolygon, але `ST_AsGeoJSON` віддає те, що лежить. Код, писаний
 * під одну з двох форм, мовчки не намалював би другу.
 */
export function outlineBounds(
  outline: Outline,
): [[number, number], [number, number]] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [x, y] = node as [number, number];
      if (x < west) west = x;
      if (x > east) east = x;
      if (y < south) south = y;
      if (y > north) north = y;
      return;
    }
    for (const child of node) walk(child);
  };
  walk(outline.coordinates);
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return [
    [west, south],
    [east, north],
  ];
}

// 🔴 ФАРБА ОБРИСУ ЖИВЕ ТУТ, А НЕ В `site-map.tsx`, І ЦЕ НАВМИСНО.
//
// Рецензія PR #292 показала дірку, якої я не бачив: мутація
// `'fill-opacity': 0.14 → 0` разом із `'line-width': 2 → 0` робить
// обрис цілком невидимим — і все лишається зеленим. Шари існують,
// джерело додане, атрибут стоїть, жоден тест не питає про фарбу, а
// візуальний тест маскує канвас і сторінки кемпінгу взагалі не має.
//
// Тобто 54% сторінок показували б порожню мапу під підписом, який
// обіцяє контур ділянки. Рівно той клас дефекту, проти якого написана
// вся ця картка.
//
// Тут вони тому, що `site-map.tsx` чіпає `window` ще на імпорті
// (MapLibre), і юніт-тест його підняти не може. Цей модуль чистий.
export const OUTLINE_FILL_OPACITY = 0.14;
export const OUTLINE_LINE_WIDTH = 2;
