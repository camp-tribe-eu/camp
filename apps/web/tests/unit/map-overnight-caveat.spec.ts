import { expect, test } from '@playwright/test';
import MapFilters from '@/components/map-filters';
import { EMPTY_FILTERS, type MapFilterState } from '@/lib/map-filter';
import { renderComponent } from './render-component';
import { everythingSaid } from './rendered-text';

// CAMP-255 — на мапі є фільтр «Wild camping», і до цього файлу жодного
// застереження про законність ночівлі поруч із ним не було.
//
// 🔴 ЧОМУ ЦЕ НЕ ПРИДИРКА. Заміряно 25.09.2026 по ЄС-27: на 48 970 місць
// ночівлі відкриті дані дають **651** ствердну відповідь «тут можна».
// Тобто питання «чи можна мені тут заночувати» у відкритих даних
// відповіді не має — а фільтр показує 2 917 точок типу `wild` і виглядає
// як відповідь.
//
// Тип місця на це питання теж не відповідає: `wild` приходить із
// `backcountry=yes` або `camp_site=basic`, а це про те, ЧИМ місце є, не
// про те, що там дозволено.
//
// Застереження вже існувало — але на сторінці ОКРЕМОГО кемпінгу
// (`travel-notice.tsx`). Читач, який відкрив мапу й фільтрує, туди не
// заходив.

// 🔴 `everythingSaid` віддає МАСИВ рядків (видимий текст, `title`,
// `aria-label`), не один рядок. Перша редакція цього файлу робила
// `toContain` по масиву — тобто вимагала ТОЧНОГО збігу елемента, і
// падала, хоч застереження малювалось. Зшиваємо в один рядок.
const said = (state: MapFilterState) => everythingSaid(render(state)).join(' ');

const render = (state: MapFilterState) =>
  renderComponent(MapFilters, {
    state,
    onChange: () => {},
    shown: 12,
    total: 47,
    unknownExcluded: 0,
    dataState: { kind: 'ready' },
  });

test('🔴 застереження про ночівлю видно БЕЗ жодного кліку', () => {
  // Типовий стан: нічого не обрано, читач щойно відкрив мапу.
  expect(said(EMPTY_FILTERS)).toContain('not permission to stay the night');
});

test('🔴 і воно НЕ зʼявляється лише тоді, коли обрано «Wild»', () => {
  // Застереження, яке треба спершу викликати, половина читачів не
  // побачить — те саме міркування записане в `travel-notice.tsx`.
  for (const types of [[], ['wild'], ['paid'], ['free', 'rv_park']] as const) {
    expect(
      said({ ...EMPTY_FILTERS, types: [...types] }),
      `types=${JSON.stringify(types)}`,
    ).toContain('not permission to stay the night');
  }
});

test('воно називає, ХТО вирішує, а не просто застерігає', () => {
  // «Будьте обережні» нічого не каже. Читач мусить дізнатись, де шукати
  // відповідь: місцеві правила й власник землі.
  expect(said(EMPTY_FILTERS)).toContain('local rules');
  expect(said(EMPTY_FILTERS)).toContain('landowner');
});

test('🔴 і каже, що тип місця — це не дозвіл', () => {
  // Найважливіше речення: «Wild camping» описує, ЧИМ місце є, а не що
  // там можна. Без нього чип читається як дозвіл.
  expect(said(EMPTY_FILTERS)).toContain('describes what it is');
});
