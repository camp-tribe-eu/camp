import { expect, test } from '@playwright/test';

import AmenityList from '@/components/amenity-list';
import {
  AMENITY_KEYS,
  AMENITY_LABEL,
  type AmenityKey,
  type AmenityValue,
} from '@/lib/api';
import { renderComponent, rendersNothing } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-453, пункт 3 — зручності значками замість сітки YES/NO/NOT RECORDED.
 *
 * 🔴 ГОЛОВНЕ ТВЕРДЖЕННЯ ТУТ НЕ ПРО ВИГЛЯД, А ПРО ТРЕТІЙ СТАН. «Не
 * записано» — це не «немає». Так сказано в наших умовах, на цьому
 * стоїть кожен фільтр, що друкує, скільки кемпінгів він відкинув за
 * браком даних, і це найлегше загубити саме тоді, коли робиш гарно:
 * порожня клітинка або перекреслений значок читались би як «ні».
 */

const all = (v: AmenityValue) =>
  Object.fromEntries(AMENITY_KEYS.map((k) => [k, v])) as Record<
    AmenityKey,
    AmenityValue
  >;

const render = (values: Record<AmenityKey, AmenityValue>) =>
  renderComponent(AmenityList, {
    keys: AMENITY_KEYS,
    labels: AMENITY_LABEL,
    values,
    // CAMP-521: статус походження — те, що дає сторінка для імпортованого
    // запису; що саме тут друкується, читає `trust-status.spec.tsx`.
    trust: Object.fromEntries(
      AMENITY_KEYS.map((k) => [k, values[k] === 'unknown' ? 'unknown' : 'imported']),
    ) as Record<AmenityKey, 'unknown' | 'imported'>,
  });

/** Скільки значків зручностей у виводі — рахуємо ЕЛЕМЕНТИ, не згадки. */
const facilityIcons = (html: string) =>
  (html.match(/<span class="ct-amen__icon">/g) ?? []).length;

test('🔴 значок є в КОЖНОЇ зручності, і він у кожної свій', () => {
  expect(AMENITY_KEYS.length).toBeGreaterThan(5);
  const html = render(all('unknown'));
  expect(facilityIcons(html)).toBe(AMENITY_KEYS.length);

  // 🔴 ОДИН ЗНАЧОК НА ВСІХ — ЦЕ НЕ ЗНАЧКИ, А ОРНАМЕНТ. Перша редакція
  // рахувала лише кількість елементів, і мутація «малювати всюди той
  // самий значок» проходила: одинадцять однакових картинок проти
  // одинадцяти різних — для ока це різні сторінки, для лічильника ні.
  const drawn = [...html.matchAll(/<span class="ct-amen__icon">([\s\S]*?)<\/span>/g)].map(
    (m) => m[1],
  );
  expect(drawn.length).toBe(AMENITY_KEYS.length);
  expect(
    new Set(drawn).size,
    `різних значків ${new Set(drawn).size} на ${AMENITY_KEYS.length} зручностей`,
  ).toBe(AMENITY_KEYS.length);
});

test('🔴 «не записано» не читається як «немає»', () => {
  const html = render(all('unknown'));
  const text = visibleText(html);

  // Слово, а не порожнеча.
  expect(text).toContain('Not recorded');
  expect(text, 'незаписана зручність сказала «No»').not.toContain('No\n');

  // 🔴 І значок свій: риска, а не хрестик. Перекреслений значок на
  // незаписаній зручності — це твердження, якого ми не робили.
  //
  // 🔴 ПОРІВНЮЄМО САМ `<svg>`, А НЕ «ЗНАЧОК ІЗ ПІДПИСОМ». Перша редакція
  // брала весь вміст `.ct-amen__state` — разом зі словом, — тож мутація
  // «дати „не записано“ хрестик» лишилась ЗЕЛЕНОЮ: слова однаково різні
  // («Not recorded» проти «No»), і рядки не збіглись би за будь-яких
  // значків.
  const stateIcon = (markup: string) =>
    markup.match(/ct-amen__state">(<svg[\s\S]*?<\/svg>)/)?.[1] ?? '';
  const unknownIcon = stateIcon(html);
  const noIcon = stateIcon(render(all('no')));
  const yesIcon = stateIcon(render(all('yes')));
  expect(unknownIcon, 'значка «не записано» немає').not.toBe('');
  expect(unknownIcon, 'у «не записано» той самий значок, що в «немає»').not.toBe(
    noIcon,
  );
  expect(unknownIcon, 'у «не записано» той самий значок, що в «так»').not.toBe(
    yesIcon,
  );
});

test('🔴 стан не передається самим кольором — у кожного є слово', () => {
  for (const [value, word] of [
    ['yes', 'Yes'],
    ['no', 'No'],
    ['unknown', 'Not recorded'],
  ] as const) {
    const text = visibleText(render(all(value)));
    expect(text, `стан «${value}» не сказаний словом`).toContain(word);
  }
});

test('стан видно й у розмітці, не лише оком', () => {
  const mixed = { ...all('unknown'), shower: 'yes', wifi: 'no' } as Record<
    AmenityKey,
    AmenityValue
  >;
  const html = render(mixed);
  expect(html).toContain('data-amenity="shower" data-state="yes"');
  expect(html).toContain('data-amenity="wifi" data-state="no"');
  expect((html.match(/data-state="unknown"/g) ?? []).length).toBe(
    AMENITY_KEYS.length - 2,
  );
});

test('🔴 порожній перелік не малює рамки', () => {
  expect(
    rendersNothing(AmenityList, {
      keys: [],
      labels: AMENITY_LABEL,
      trust: {} as Record<AmenityKey, 'imported'>,
      values: all('unknown'),
    }),
  ).toBe(true);
});

test('🔴 порядок ключів лишається той, що в `AMENITY_KEYS`', () => {
  // Санітарні стоять поруч навмисно, і сортувати за станом означало б
  // переграти це рішення мовчки.
  const html = render(all('unknown'));
  const order = [...html.matchAll(/data-amenity="([a-zA-Z]+)"/g)].map(
    (m) => m[1],
  );
  expect(order).toEqual([...AMENITY_KEYS]);
});
