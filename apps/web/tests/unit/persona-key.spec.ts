import { expect, test } from '@playwright/test';

import { PERSONA_KEY } from '@/components/persona-toggle';
import { PERSONA_BOOTSTRAP } from '@/lib/persona';

/**
 * CAMP-501 — ключ вибору записаний у двох місцях, і це мусить лишитись
 * однією правдою (та сама причина, що в `theme-key.spec.ts`: скрипт у
 * `<head>` не може імпортувати з клієнтського компонента, а сторож
 * правових сторінок вимагає літерал там, де стоїть `.setItem(`).
 *
 * 🔴 Скрипт ВИКОНУЄТЬСЯ тут над підробленим сховищем, а не лише читається
 * як рядок: саме він ставить атрибут до першого малювання.
 */

function run(stored: string | null | 'throws') {
  const dataset: Record<string, string> = {};
  const localStorage = {
    getItem(k: string) {
      if (stored === 'throws') throw new Error('blocked');
      return k === PERSONA_KEY ? stored : null;
    },
  };
  new Function('localStorage', 'document', PERSONA_BOOTSTRAP)(localStorage, {
    documentElement: { dataset },
  });
  return dataset.persona ?? null;
}

test('🔴 скрипт у <head> читає рівно той ключ, що пише компонент', () => {
  expect(PERSONA_KEY).toBe('camptribe.persona');
  expect(PERSONA_BOOTSTRAP).toContain(`'${PERSONA_KEY}'`);
  // Виконаний над сховищем, де лежить саме цей ключ — атрибут стає.
  expect(run('renter'), 'скрипт не побачив збереженого вибору').toBe('renter');
});

test('скрипт ставить атрибут лише для двох відомих значень', () => {
  expect(run('owner')).toBe('owner');
  expect(run('admin')).toBeNull();
  expect(run('')).toBeNull();
  expect(run(null)).toBeNull();
});

test('заблоковане сховище не валить сторінку', () => {
  expect(run('throws')).toBeNull();
});
