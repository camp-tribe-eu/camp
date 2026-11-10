import { expect, test } from '@playwright/test';

import { ImageWithText } from '@/components/image-with-text';
import { renderComponent, rendersNothing } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-449, пункт 4 — чергування текст/фото (знімок 441/22).
 *
 * 🔴 ПРАВИЛО КАТАЛОГУ ПЕРШИМ: порожні дані → секція не рендериться, а не
 * показує порожню рамку. Для цієї секції «порожнє» має два обличчя —
 * нема заголовка й нема фото, — і перевіряються обидва, бо дірку лишає
 * кожне з них окремо.
 */

const full = {
  image: { src: '/banners/tent.svg', alt: 'A tent at dusk' },
  caption: 'Where to sleep',
  heading: 'Campsites, not guesses',
  text: 'Every site comes from OpenStreetMap, with the gaps left as gaps.',
  cta: { href: '/map', label: 'Open the map' },
};

test('🔴 без заголовка не малює НІЧОГО', () => {
  expect(rendersNothing(ImageWithText, { ...full, heading: '   ' })).toBe(true);
});

test('🔴 без фото не малює НІЧОГО', () => {
  expect(rendersNothing(ImageWithText, { ...full, image: { src: '' } })).toBe(
    true,
  );
});

test('надзаголовок, заголовок, текст і кнопка доходять до читача', () => {
  const text = visibleText(renderComponent(ImageWithText, full));
  expect(text).toContain('Where to sleep');
  expect(text).toContain('Campsites, not guesses');
  expect(text).toContain('the gaps left as gaps');
  expect(text).toContain('Open the map');
});

test('🔴 фото несе свій alt, а не порожній рядок за замовчуванням', () => {
  const html = renderComponent(ImageWithText, full);
  expect(html).toContain('alt="A tent at dusk"');
});

test('кнопка необовʼязкова — без неї немає й обгортки', () => {
  const html = renderComponent(ImageWithText, { ...full, cta: undefined });
  // 🔴 ПО ЕЛЕМЕНТУ, А НЕ ПО ЗГАДЦІ КЛАСУ: правила секції їдуть у тому ж
  // виводі, тож рядок `ct-iwt__button` є там завжди. Питання — чи є div.
  expect(html).not.toContain('<div class="ct-iwt__button"');
  expect(html).toContain('<div class="ct-iwt__content"');
});

/**
 * 🔴 ЧИТАЄМО АТРИБУТ, А НЕ ЗГАДКУ. Перша редакція цих двох тестів шукала
 * підрядок `ct-iwt--reverse` у всьому виводі — і мутація «ніколи не
 * ставити цей клас» лишила її зеленою, бо рядок є в самих правилах CSS,
 * які їдуть у тому ж HTML. Тому тепер звіряється ЗНАЧЕННЯ `class`
 * секції цілком.
 */
const sectionClass = (html: string) => {
  const m = html.match(/<section class="([^"]*)"/);
  if (!m) throw new Error('секція не віддала жодного class');
  return m[1];
};

test('🔴 бік фото — це клас, і типово фото ліворуч', () => {
  expect(sectionClass(renderComponent(ImageWithText, full))).toBe(
    'ct-iwt ct-iwt--w70',
  );
  expect(
    sectionClass(
      renderComponent(ImageWithText, {
        ...full,
        imagePosition: 'right' as const,
      }),
    ),
  ).toBe('ct-iwt ct-iwt--w70 ct-iwt--reverse');
});

test('🔴 ширина фото — два варіанти теми, типово 70', () => {
  expect(sectionClass(renderComponent(ImageWithText, full))).toBe(
    'ct-iwt ct-iwt--w70',
  );
  expect(
    sectionClass(
      renderComponent(ImageWithText, { ...full, imageWidth: 50 as const }),
    ),
  ).toBe('ct-iwt ct-iwt--w50');
});

test('рівень заголовка керований — h2 типово, h3 під власним заголовком', () => {
  expect(renderComponent(ImageWithText, full)).toContain(
    '<h2 class="ct-iwt__heading"',
  );
  expect(
    renderComponent(ImageWithText, { ...full, headingLevel: 3 as const }),
  ).toContain('<h3 class="ct-iwt__heading"');
});
