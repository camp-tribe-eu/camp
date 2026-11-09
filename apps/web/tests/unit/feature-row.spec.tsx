import { expect, test } from '@playwright/test';

import FeatureRow from '@/components/feature-row';
import { PageSections } from '@/components/page-sections';
import type { SectionView } from '@/lib/page-content';
import { renderComponent, rendersNothing } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-449, пункт 5 — рядок «іконка + тайтл + текст» (знімок 441/19).
 *
 * 🔴 ПРАВИЛО КАТАЛОГУ: порожні дані → секція не рендериться. Воно тут
 * перше, бо саме його найлегше загубити, додаючи наступну секцію.
 */

const items = [
  { key: 'a', title: 'Find places', text: 'Pick a country.' },
  { key: 'b', title: 'See the surroundings', text: 'Water, towns, terrain.' },
];

test('🔴 порожній перелік не малює НІЧОГО', () => {
  expect(rendersNothing(FeatureRow, { items: [] })).toBe(true);
});

test('кожна картка несе тайтл і текст', () => {
  const text = visibleText(renderComponent(FeatureRow, { items }));
  expect(text).toContain('Find places');
  expect(text).toContain('Water, towns, terrain.');
});

test('🔴 значок необовʼязковий — картка без нього не ламається', () => {
  const html = renderComponent(FeatureRow, { items });
  // 🔴 ПО РОЗМІТЦІ, А НЕ ПО CSS. Перша редакція шукала рядок
  // `ct-feat__icon` у всьому виводі — а він там завжди є, бо правила
  // їдуть разом із компонентом. Питання в тому, чи є ЕЛЕМЕНТ.
  expect(html).not.toContain('<span className="ct-feat__icon"');
  expect(html).not.toContain('class="ct-feat__icon"');
  const withIcon = renderComponent(FeatureRow, {
    items: [{ ...items[0], icon: <span>1</span> }],
  });
  expect(withIcon).toContain('class="ct-feat__icon"');
  // Значок — картинка стану, а не зміст: читач екрана його не вимовляє.
  expect(withIcon).toContain('aria-hidden="true"');
});

test('🔴 розміри взято з теми, а не вигадано', () => {
  // Правила їдуть разом із компонентом, тож секцію можна покласти на
  // будь-який шаблон — у цьому й сенс каталогу.
  const html = renderComponent(FeatureRow, { items });
  expect(html).toContain('border-radius:calc(var(--r,16px) * .75)');
  expect(html).toContain('.ct-feat__title{font-weight:700');
  // До 768px — стовпчик, від 768 — рядок. Це те саме місце перелому,
  // що й у теми.
  expect(html).toContain('@media(min-width:768px)');
});

test('у ряд стає рівно стільки карток, скільки дали', () => {
  const html = renderComponent(FeatureRow, { items });
  expect((html.match(/class="ct-feat__item"/g) ?? []).length).toBe(items.length);
});

/**
 * 🔴 І СЕКЦІЯ СПРАВДІ ВЖИТА, а не лежить у каталозі окремо. Компонент,
 * якого ніхто не використовує, — це не секція каталогу, а мертвий код,
 * що проходить власні тести.
 */
test('🔴 кроки на головній намальовані цією секцією', () => {
  const html = renderComponent(PageSections, {
    sections: [
      {
        type: 'steps',
        heading: 'How this works',
        items: [
          { term: 'Find places', text: 'Pick a country.' },
          { term: 'See the surroundings', text: 'Water and towns.' },
        ],
      } as SectionView,
    ],
  });
  expect(html, 'кроки малюються не секцією каталогу').toContain('data-testid="steps"');
  expect(html).toContain('ct-feat__item');
  // Нумерація лишилась: вона була до каталогу й мусить лишитись.
  expect(visibleText(html)).toContain('1');
});
