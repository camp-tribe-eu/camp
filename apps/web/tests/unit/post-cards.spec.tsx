import { expect, test } from '@playwright/test';

import PostCards from '@/components/post-cards';
import { renderComponent, rendersNothing } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-449, секція 10, і CAMP-465, пункт 3 — картки матеріалів.
 *
 * 🔴 ГОЛОВНЕ ТУТ — ЩО СЕКЦІЮ МОЖНА КЛАСТИ НА БУДЬ-ЯКУ СТОРІНКУ. Власник
 * просив чергувати внизу сторінок то блог-пости, то інші фічі; доки
 * розмітка жила в каталозі блогу, «покласти її ще десь» означало
 * скопіювати, а копія розходиться з оригіналом тихо.
 */

const items = [
  {
    key: 'a',
    href: '/blog/one',
    title: 'What the data does not say',
    excerpt: 'A campsite record is never complete.',
    meta: '1 October 2026 · CampTribe',
  },
  { key: 'b', href: '/blog/two', title: 'Second post' },
];

const cardCount = (html: string) => (html.match(/<li class="ct-post"/g) ?? []).length;

test('🔴 порожній перелік не малює НІЧОГО', () => {
  expect(rendersNothing(PostCards, { items: [] })).toBe(true);
});

test('кожен матеріал — своя картка, з назвою й адресою', () => {
  const html = renderComponent(PostCards, { items });
  expect(cardCount(html)).toBe(items.length);
  expect(html).toContain('href="/blog/one"');
  const text = visibleText(html);
  expect(text).toContain('What the data does not say');
  expect(text).toContain('A campsite record is never complete.');
  expect(text).toContain('1 October 2026 · CampTribe');
});

test('🔴 уривок і підпис необовʼязкові — без них немає й елементів', () => {
  const html = renderComponent(PostCards, { items: [items[1]] });
  // 🔴 ПО ЕЛЕМЕНТУ, А НЕ ПО ЗГАДЦІ КЛАСУ. Правила секції їдуть у тому
  // самому HTML, тож рядки `ct-post__text` і `ct-post__meta` є там
  // завжди. Той самий капкан уже був сьогодні тричі — у секції 4,
  // у зірках відгуків і в лічильнику сегментів шкали.
  expect(html, 'намальовано порожній уривок').not.toContain('<p class="ct-post__text"');
  expect(html, 'намальовано порожню пігулку').not.toContain('<span class="ct-post__meta"');
  // А назва є завжди.
  expect(visibleText(html)).toContain('Second post');
});

test('🔴 без фото картка показує заглушку теми, а не лого: жодного <img>, сховано від читача екрана', () => {
  const html = renderComponent(PostCards, { items });
  expect(html, 'картка без фото все ще бере лого').not.toContain('/logo.svg');
  expect(html.match(/<img\b/g) ?? [], 'заглушка не має бути картинкою').toEqual([]);
  const placeholders = html.match(/data-testid="photo-placeholder"/g) ?? [];
  expect(placeholders.length, 'заглушок менше, ніж карток').toBe(items.length);
  // Заглушка сховано від диктора й не веде нікуди окремо від назви.
  expect(html.match(/<div[^>]*data-testid="photo-placeholder"[^>]*>/g)?.every((d) => d.includes('aria-hidden="true"'))).toBe(true);
  expect(visibleText(html)).not.toMatch(/coming soon|no photo/i);

  // Своє фото, коли воно є, витісняє заглушку — лише на цій картці.
  const withImage = renderComponent(PostCards, {
    items: [{ ...items[1], image: { src: '/banners/tent.svg', alt: 'A tent' } }, items[0]],
  });
  expect(withImage).toContain('src="/banners/tent.svg"');
  expect(withImage).toContain('alt="A tent"');
  expect((withImage.match(/data-testid="photo-placeholder"/g) ?? []).length).toBe(1);
});

/**
 * 🔴 ЗОБРАЖЕННЯ НЕ ДУБЛЮЄ ПОСИЛАННЯ ДЛЯ ЧИТАЧА ЕКРАНА. Картка теми має
 * два посилання на той самий матеріал — фото й назву. Для ока це одне;
 * для диктора — два однакові оголошення поспіль, і для клавіатури — два
 * натиски табом до одного й того самого.
 */
test('🔴 посилання-картинка сховане від читача екрана й від табуляції', () => {
  // И з фото, і із заглушкою: інакше диктор чує два однакові посилання поспіль.
  for (const item of [
    items[1],
    { ...items[1], image: { src: '/banners/tent.svg', alt: 'A tent' } },
  ]) {
    const html = renderComponent(PostCards, { items: [item] });
    const link = html.match(/<a[^>]*class="ct-post__(?:media|link)"[^>]*>/)?.[0] ?? '';
    expect(link, 'посилання-картинки немає').not.toBe('');
    expect(link).toContain('tabindex="-1"');
    expect(link).toContain('aria-hidden="true"');
  }
});

test('🔴 рівень заголовка керований: h3 типово, h2 там, де картки є розділом', () => {
  expect(renderComponent(PostCards, { items })).toContain('<h3 class="ct-post__title"');
  expect(
    renderComponent(PostCards, { items, titleAs: 'h2' as const }),
  ).toContain('<h2 class="ct-post__title"');
});

test('🔴 три колонки — це клас, і типово їх дві', () => {
  expect(renderComponent(PostCards, { items })).toContain('<ul class="ct-posts"');
  expect(
    renderComponent(PostCards, { items, columns: 3 as const }),
  ).toContain('<ul class="ct-posts ct-posts--three"');
});
