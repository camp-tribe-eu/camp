import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  OWN_GROUP_ID,
  OWN_MAX_ITEMS,
  OWN_MAX_LEN,
  cleanOwnItems,
  ownItemId,
  packingList,
  withOwnItems,
} from '@/lib/packing';

/**
 * CAMP-458 — свої пункти в списку спорядження.
 *
 * Власник: «дати людині додавати СВОЇ пункти, копіювати і ділитися
 * списком», і одразу межа, дослівно: «люди понаписують гадості — тому
 * їх не беремо собі нотатки».
 *
 * 🔴 МЕЖА ДОВОДИТЬСЯ, А НЕ ОГОЛОШУЄТЬСЯ. Картка просить «мутація:
 * додати пункт користувача й довести запитом до бази, що в ній нічого
 * не зʼявилось». Запит до бази довів би стан однієї бази в одну мить;
 * сильніше — довести, що надіслати НЕМА ЧИМ: у модулі немає жодного
 * мережевого виклику. Тоді твердження тримається незалежно від того,
 * яку базу хтось підключить завтра.
 */

const SRC = join(
  __dirname,
  '..',
  '..',
  'src',
  'components',
  'packing-list-builder.tsx',
);

test.describe('🔴 текст людини не має куди поїхати', () => {
  test('у компоненті немає жодного мережевого виклику', () => {
    const code = readFileSync(SRC, 'utf8');
    // Якір: файл справді прочитано й він той, що треба.
    expect(code, 'прочитано не той файл — замір сліпий').toContain('own-input');
    for (const call of [
      'fetch(',
      'sendBeacon',
      'XMLHttpRequest',
      'EventSource',
      'WebSocket',
      'navigator.geolocation',
    ]) {
      expect(code.includes(call), `у збирача списку зʼявився ${call}`).toBe(false);
    }
  });

  test('і жодна форма не може нікуди надіслати', () => {
    // 🔴 ПЕРША РЕДАКЦІЯ ЦЬОГО ТЕСТУ БУЛА ПРОСТО ХИБНОЮ: вона вимагала,
    // щоб `<form>` не було зовсім, і почервоніла на здоровому коді.
    // Форма там є й була до CAMP-458 — вона групує поля подорожі й
    // дає клавіатурі звичну поведінку. Небезпечна не форма, а форма,
    // ЯКА МАЄ КУДИ НАДСИЛАТИ: з `action` або без гасіння `submit`.
    const code = readFileSync(SRC, 'utf8');
    // 🔴 ВІКНО, А НЕ «ДО ПЕРШОГО `>`». Перша спроба брала
    // `<form…?>` ліниво — і обрізалась на `>` усередині
    // `onSubmit={(e) =>`. Та сама пастка, що колись зіпсувала
    // `check-heading-weight`: у JSX `>` живе й у виразах, не лише в
    // кінці тега.
    const forms = [...code.matchAll(/<form\b/g)].map((m) =>
      code.slice(m.index, m.index + 300),
    );
    expect(forms.length, 'розбір не знайшов жодної форми — замір сліпий').toBeGreaterThan(0);
    for (const f of forms) {
      expect(f, `форма з action: ${f}`).not.toMatch(/\baction=/);
      expect(f, `форма без гасіння submit: ${f}`).toContain('e.preventDefault()');
    }
  });
});

test.describe('межі переліку — не косметика, а довжина адреси', () => {
  test('порожні й самі пробіли відкидаються', () => {
    expect(cleanOwnItems(['', '   ', '\t\n'])).toEqual([]);
  });

  test('дублікати знімаються, байдуже до регістру й пробілів', () => {
    expect(cleanOwnItems(['Head torch', 'head   torch', ' HEAD TORCH '])).toEqual([
      'Head torch',
    ]);
  });

  test(`не більше ${OWN_MAX_ITEMS} пунктів`, () => {
    const many = Array.from({ length: OWN_MAX_ITEMS + 10 }, (_, i) => `item ${i}`);
    expect(cleanOwnItems(many)).toHaveLength(OWN_MAX_ITEMS);
  });

  test(`не довше ${OWN_MAX_LEN} символів`, () => {
    const [only] = cleanOwnItems(['x'.repeat(OWN_MAX_LEN + 40)]);
    expect(only).toHaveLength(OWN_MAX_LEN);
  });
});

test.describe('🔴 галочка тримається за текст, а не за номер', () => {
  test('видалення сусіда не зсуває чужу позначку', () => {
    // Якби id були `own-0`, `own-1`…, видалення першого зробило б
    // позначеним інший рядок — мовчки й непомітно.
    const before = ownItemId('Head torch');
    const after = ownItemId('Head torch');
    expect(before).toBe(after);
    expect(ownItemId('Head torch')).not.toBe(ownItemId('Spare fuse'));
  });

  test('id не залежить від регістру й зайвих пробілів', () => {
    expect(ownItemId('  Head   torch ')).toBe(ownItemId('head torch'));
  });
});

test.describe('група своїх пунктів доповнює, а не заміщає', () => {
  const input = {
    vehicle: 'motorhome',
    nights: 7,
    people: 2,
    season: 'warm',
    cooking: true,
    electricity: true,
    children: false,
    dog: false,
  } as Parameters<typeof packingList>[0];

  test('без своїх пунктів список не міняється зовсім', () => {
    const base = packingList(input);
    expect(withOwnItems(base, [])).toEqual(base);
    expect(withOwnItems(base, ['  '])).toEqual(base);
  });

  test('зі своїми — та сама основа плюс одна група в кінці', () => {
    const base = packingList(input);
    const out = withOwnItems(base, ['Head torch', 'Spare fuse']);
    expect(out).toHaveLength(base.length + 1);
    expect(out.slice(0, base.length)).toEqual(base);
    const last = out[out.length - 1];
    expect(last.id).toBe(OWN_GROUP_ID);
    expect(last.items.map((i) => i.label)).toEqual(['Head torch', 'Spare fuse']);
  });
});
