import { expect, test } from '@playwright/test';

import ReviewCards from '@/components/review-cards';
import { renderComponent, rendersNothing } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-449, пункт 9 — картки-цитати (знімок 441/08).
 *
 * 🔴 ГОЛОВНЕ ТВЕРДЖЕННЯ ТУТ НЕ ПРО ВИГЛЯД, А ПРО ЧЕСНІСТЬ: зірковий ряд
 * зʼявляється ЛИШЕ там, де є число, і число це читає читач екрана.
 * Оформлення, що вдає дані, — це рівно те, чого картка просить не
 * робити, поки відгуків немає.
 */

const items = [
  {
    key: 'a',
    quote: 'The water distance was right to the metre.',
    author: 'Sample author',
    role: 'Sample role',
    rating: 4,
  },
  {
    key: 'b',
    quote: 'Found a quiet site two hours from the ferry.',
    author: 'Second author',
  },
];

/**
 * Скільки `<svg>`-зірок у виводі і скільки з них запалені.
 *
 * 🔴 РАХУЄМО АТРИБУТ, А НЕ ЗГАДКУ. Перша редакція шукала
 * `ct-rev__star--on` підрядком — і давала на одиницю більше завжди, бо
 * цей самий рядок стоїть у правилах CSS, які їдуть у тому ж HTML. Той
 * самий капкан уже був у секції 4 (`ct-iwt--reverse`) і в лічильнику
 * сегментів шкали. Тому обидва лічильники звіряють ЗНАЧЕННЯ `class`.
 */
const starCount = (html: string) =>
  (html.match(/<svg class="ct-rev__star[" ]/g) ?? []).length;
const onCount = (html: string) =>
  (html.match(/class="ct-rev__star ct-rev__star--on"/g) ?? []).length;

test('🔴 порожній перелік не малює НІЧОГО', () => {
  expect(rendersNothing(ReviewCards, { items: [] })).toBe(true);
});

test('цитата, імʼя й роль доходять до читача', () => {
  const text = visibleText(renderComponent(ReviewCards, { items }));
  expect(text).toContain('right to the metre');
  expect(text).toContain('Sample author');
  expect(text).toContain('Sample role');
});

test('🔴 без оцінки немає жодної зірки', () => {
  const html = renderComponent(ReviewCards, { items: [items[1]] });
  expect(starCount(html)).toBe(0);
  expect(html).not.toContain('out of');
});

test('🔴 з оцінкою — рівно шкала зірок, і число читає читач екрана', () => {
  const html = renderComponent(ReviewCards, { items: [items[0]] });
  expect(starCount(html)).toBe(5);
  expect(onCount(html)).toBe(4);
  expect(html).toContain('4 out of 5');
});

test('🔴 шкала керована: 10 зірок при ratingMax 10', () => {
  const html = renderComponent(ReviewCards, {
    items: [{ ...items[0], rating: 7, ratingMax: 10 }],
  });
  expect(starCount(html)).toBe(10);
  expect(onCount(html)).toBe(7);
  expect(html).toContain('7 out of 10');
});

/**
 * 🔴 ЧИСЛО ЗЗОВНІ МОЖЕ БУТИ ЯКИМ ЗАВГОДНО. Коли відгуки зʼявляться,
 * оцінка прийде з форми або з імпорту, і `9` при шкалі 5 намалювало б
 * девʼять зірок у ряд на пʼять — тобто дефект рендера, а не погані дані.
 */
test('🔴 оцінка поза шкалою затискається — і в ряду, і в числі', () => {
  const high = renderComponent(ReviewCards, {
    items: [{ ...items[0], rating: 9 }],
  });
  expect(starCount(high)).toBe(5);
  expect(onCount(high)).toBe(5);
  // 🔴 Ряд затиснутий сам собою — збрехати може саме це число.
  expect(high).toContain('5 out of 5');
  expect(high).not.toContain('9 out of 5');

  const low = renderComponent(ReviewCards, {
    items: [{ ...items[0], rating: -3 }],
  });
  expect(starCount(low)).toBe(5);
  expect(onCount(low)).toBe(0);
  expect(low).toContain('0 out of 5');
  expect(low).not.toContain('-3 out of 5');
});

test('🔴 дробову оцінку вимовляють як є, округлює лише ряд', () => {
  const html = renderComponent(ReviewCards, {
    items: [{ ...items[0], rating: 4.5 }],
  });
  expect(html).toContain('4.5 out of 5');
  expect(onCount(html)).toBe(5);
});

test('🔴 нуль — це оцінка, а не її відсутність', () => {
  const html = renderComponent(ReviewCards, {
    items: [{ ...items[0], rating: 0 }],
  });
  expect(starCount(html)).toBe(5);
  expect(html).toContain('0 out of 5');
});

test('аватар необовʼязковий — без нього немає й обгортки', () => {
  const html = renderComponent(ReviewCards, { items: [items[1]] });
  expect(html).not.toContain('<span class="ct-rev__thumb"');

  const withAvatar = renderComponent(ReviewCards, {
    items: [{ ...items[1], avatar: { src: '/banners/tent.svg', alt: 'A tent' } }],
  });
  expect(withAvatar).toContain('<span class="ct-rev__thumb"');
  expect(withAvatar).toContain('alt="A tent"');
});

test('цитата лежить у blockquote, а не в абзаці без розмітки', () => {
  expect(renderComponent(ReviewCards, { items })).toContain(
    '<blockquote class="ct-rev__quote"',
  );
});
