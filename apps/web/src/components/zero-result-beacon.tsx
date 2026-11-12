'use client';

import { useEffect } from 'react';
import { filterTokens, sendZeroResult } from '@/lib/events';
import { isFiltering } from '@/lib/map-filter';
import type { MapFilterState } from '@/lib/map-filter';

// CAMP-504. Нульовий результат на карті: у вікні карти кемпінги ЄСТЬ
// (`total`), а фільтри сховали всі (`shown`). Це незадоволений попит, який
// потім можна порахувати. Порожній вигляд без фільтрів (море) — не пошук і не
// рахується. Затримка 2 с: фільтри перемикають по одному, і проміжний
// порожній стан не повинен стати записом.
//
// Окремий компонент, а не ефект у `MapCount`: `MapCount` викликають як
// звичайну функцію (`tests/unit/render-component.ts`), а гачок там падає.
export default function ZeroResultBeacon({
  ready,
  shown,
  total,
  state,
}: {
  ready: boolean;
  shown: number;
  total: number;
  state: MapFilterState;
}) {
  const zero = ready && isFiltering(state) && total > 0 && shown === 0;
  const tokens = JSON.stringify(filterTokens(state));
  useEffect(() => {
    if (!zero) return;
    const timer = setTimeout(
      () => sendZeroResult('map', JSON.parse(tokens) as string[]),
      2000,
    );
    return () => clearTimeout(timer);
  }, [zero, tokens]);
  return null;
}
