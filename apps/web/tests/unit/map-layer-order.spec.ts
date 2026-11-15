import { expect, test } from '@playwright/test';
import { droughtBeforeId, underBaseLabels } from '@/lib/map-layer-order';

// CAMP-454. Шар посухи мусить стояти ПІД підписами основи, але не під нашими
// кругами кемпінгів. Обидві половини — окремі твердження, бо кожну можна
// зламати окремо: «перший символьний шар» без «лише основи» кладе посуху
// перед лічильником кластерів, тобто над кругами.

const BASE = [
  { id: 'bg', type: 'background' },
  { id: 'water', type: 'fill' },
  { id: 'road', type: 'line' },
  { id: 'place-label', type: 'symbol' },
  { id: 'poi-label', type: 'symbol' },
];
const OURS = new Set(['drought', 'wildfire-areas', 'clusters', 'cluster-count', 'points']);
const WITH_OURS = [
  ...BASE,
  { id: 'wildfire-areas', type: 'fill' },
  { id: 'clusters', type: 'circle' },
  { id: 'cluster-count', type: 'symbol' },
  { id: 'points', type: 'circle' },
];

test.describe('droughtBeforeId', () => {
  test('is the first symbol layer of the BASE style', () => {
    expect(droughtBeforeId(WITH_OURS, OURS)).toBe('place-label');
  });

  test('🔴 never a symbol layer of ours: the cluster counter would put drought over the circles', () => {
    const flat = [{ id: 'bg', type: 'background' }, ...WITH_OURS.slice(5)];
    // No base labels: goes under the LOWEST of ours, not under `cluster-count`.
    expect(droughtBeforeId(flat, OURS)).toBe('wildfire-areas');
  });

  test('nothing of ours and no labels: on top (undefined)', () => {
    expect(droughtBeforeId([{ id: 'bg', type: 'background' }], OURS)).toBeUndefined();
  });
});

test.describe('underBaseLabels', () => {
  const drawn = (before: string | undefined) => {
    const l = WITH_OURS.map((x) => ({ ...x }));
    const at = before ? l.findIndex((x) => x.id === before) : l.length;
    l.splice(at, 0, { id: 'drought', type: 'raster' });
    return l;
  };
  test('yes when every base label is above it', () => {
    expect(underBaseLabels(drawn('place-label'), OURS, 'drought')).toBe('yes');
  });
  test('no when a base label is below it', () => {
    expect(underBaseLabels(drawn(undefined), OURS, 'drought')).toBe('no');
    expect(underBaseLabels(drawn('poi-label'), OURS, 'drought')).toBe('no');
  });
  test('n/a when the base has no labels or the layer is absent', () => {
    expect(underBaseLabels([{ id: 'bg', type: 'background' }, { id: 'drought', type: 'raster' }], OURS, 'drought')).toBe('n/a');
    expect(underBaseLabels(BASE, OURS, 'drought')).toBe('n/a');
  });
});
