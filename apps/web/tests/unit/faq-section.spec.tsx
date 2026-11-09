import { expect, test } from '@playwright/test';

import Faq from '@/components/faq';
import { renderComponent, rendersNothing } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-449, пункт 8 — FAQ-акордеон як секція каталогу.
 *
 * Власник: «FAQ потрібен ширше по сайту: він працює і на людей, і на
 * SEO/AEO». До цієї картки акордеон діставався рівно одній сторінці.
 *
 * 🔴 ПРАВИЛО КАТАЛОГУ, ЯКЕ КАРТКА ВИМАГАЄ ВІД КОЖНОЇ СЕКЦІЇ: порожні
 * дані → секція не рендериться, а не ламається й не показує порожню
 * рамку.
 */

const items = [
  { key: 'q1', question: 'Is there water?', answer: 'Yes, 200 m away.' },
  { key: 'q2', question: 'Can I bring a dog?', answer: 'Not recorded.' },
];

test('🔴 порожній перелік не малює НІЧОГО — ні рамки, ні заголовка', () => {
  expect(rendersNothing(Faq, { items: [] })).toBe(true);
});

test('🔴 відповідь лежить у ВІДДАНОМУ HTML, а не зʼявляється по кліку', () => {
  // Саме це робить FAQ придатним для пошуку й ШІ-асистента, і саме
  // цього не дає акордеон теми на JS: там вміст закритого пункту не
  // існує, доки не виконається скрипт.
  const html = renderComponent(Faq, { items });
  expect(visibleText(html)).toContain('Yes, 200 m away.');
  expect(visibleText(html)).toContain('Not recorded.');
});

test('🔴 це нативний <details>, а не div із роллю', () => {
  const html = renderComponent(Faq, { items });
  expect(html).toContain('<details');
  expect(html).toContain('<summary');
  // Жодного `onClick` у відданій розмітці: відкривання робить браузер.
  expect(html).not.toContain('role="button"');
});

test('кожен пункт відкривається окремо — це не один спільний стан', () => {
  const html = renderComponent(Faq, { items });
  expect((html.match(/<details/g) ?? []).length).toBe(items.length);
});

test('вигляд успадковано від теми: значок у рамці й поворот на 90°', () => {
  const html = renderComponent(Faq, { items });
  // Правила їдуть разом із компонентом, тож секцію можна покласти на
  // будь-який шаблон — у цьому й сенс каталогу.
  expect(html).toContain('.ct-faq__item[open] .ct-faq__plus-v{transform:rotate(90deg)}');
  expect(html).toContain('.ct-faq__control{display:flex');
});
