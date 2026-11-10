import { expect, test } from '@playwright/test';

import SpecLevel from '@/components/spec-level';
import { renderComponent, rendersNothing } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-449, пункт 7 — шкала-рівень (знімок 441/16). Власник позначив її
 * 🔴 як «готовий формат під зручності кемпінгу і характеристики
 * кемпера».
 *
 * 🔴 ЦЕ ШКАЛА ЗАМІРЯНОГО, А НЕ ОЦІНКИ, і тести тримають саме це:
 * знаменник обовʼязковий, значення не вилазить за межі, а смужка має
 * роль, тобто існує для читача екрана.
 */

test('🔴 без знаменника шкали немає зовсім', () => {
  // `max = 0` означає, що величини немає. Смужка, яку неможливо
  // прочитати, гірша за її відсутність.
  expect(rendersNothing(SpecLevel, { label: 'Facilities', value: 3, max: 0 })).toBe(true);
  expect(rendersNothing(SpecLevel, { label: 'Facilities', value: 3, max: -1 })).toBe(true);
});

test('підпис несе ОБИДВІ половини частки', () => {
  const text = visibleText(renderComponent(SpecLevel, { label: 'Facilities', value: 6, max: 10 }));
  expect(text).toContain('Facilities');
  expect(text).toContain('6 of 10');
});

test('🔴 смужка має роль і величину — інакше для читача екрана її немає', () => {
  const html = renderComponent(SpecLevel, { label: 'Facilities', value: 6, max: 10 });
  expect(html).toContain('role="meter"');
  expect(html).toContain('aria-valuenow="6"');
  expect(html).toContain('aria-valuemax="10"');
  expect(html).toContain('aria-label="Facilities"');
});

/**
 * 🔴 РАХУЄМО АТРИБУТИ, А НЕ ЗГАДКИ. Перша редакція шукала
 * `/ct-spec__seg--on/g` по всьому виводу й отримала 7 замість 6: сьомий
 * збіг — це саме правило в `<style>`, що їде разом із компонентом. Та
 * сама пастка, що годину тому зіпсувала тест про значок у
 * `feature-row`.
 */
const onSegments = (html: string) =>
  (html.match(/class="ct-spec__seg ct-spec__seg--on"/g) ?? []).length;
const allSegments = (html: string) =>
  (html.match(/class="ct-spec__seg(?: ct-spec__seg--on)?"/g) ?? []).length;

test('заповнених сегментів рівно стільки, скільки заміряно', () => {
  const html = renderComponent(SpecLevel, { label: 'F', value: 6, max: 10 });
  expect(onSegments(html)).toBe(6);
  expect(allSegments(html)).toBe(10);
});

test('🔴 значення за межами частки не бреше — воно затискається', () => {
  // 8 із 5 — саме та нісенітниця, яку головна вже одного разу надрукувала
  // (див. 🔴 у page.tsx). Шкала не має права її ПОКАЗАТИ.
  const over = renderComponent(SpecLevel, { label: 'F', value: 8, max: 5 });
  expect(onSegments(over)).toBe(5);
  expect(visibleText(over)).toContain('5 of 5');
  const under = renderComponent(SpecLevel, { label: 'F', value: -3, max: 5 });
  expect(onSegments(under)).toBe(0);
});

test('розміри взято з теми', () => {
  const html = renderComponent(SpecLevel, { label: 'F', value: 1, max: 3 });
  expect(html).toContain('height:6px');
  expect(html).toContain('border-radius:calc(var(--r,16px) / 4)');
  expect(html).toContain('.ct-spec__track{display:flex;gap:4px}');
});
