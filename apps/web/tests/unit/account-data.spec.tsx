import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_TITLE, DataView, type DownloadProblem } from '@/components/account-data-view';
import type { ArchiveState } from '@/lib/rights';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-229 (3/3) — що каже сторінка «Ваші дані», прочитано з ВИДАНОГО HTML.
//
// 🔴 Критерій картки: «Вивантаження дає файл, який відкривається». Файл будує й віддає
// API (`account-rights.db.spec.ts` розбирає його JSON-парсером) і перевіряє перед тим, як
// його запропонувати, `lib/rights.ts` (`rights.spec.ts`: тіло, що не JSON, — збій).
// ТУТ — друга половина: стан «архів готується» існує як СТАН екрана, а не як заглушка, і
// кожен стан показує ті кнопки, які справді можна натиснути, і не обіцяє того, чого
// сторінка не виконає (листа з посиланням ми не шлемо).

const STATES: [string, ArchiveState][] = [
  ['checking', { kind: 'checking' }],
  ['none', { kind: 'none' }],
  ['preparing', { kind: 'preparing' }],
  ['ready', { kind: 'ready', expiresAt: '2026-10-17T12:00:00.000Z' }],
  ['failed', { kind: 'failed' }],
  ['unreachable', { kind: 'unreachable' }],
  ['unavailable', { kind: 'unavailable' }],
];

const page = (
  archive: ArchiveState,
  over: Partial<{ busy: boolean; ready: boolean; problem: DownloadProblem }> = {},
) =>
  renderComponent(DataView, {
    archive,
    busy: over.busy ?? false,
    ready: over.ready ?? true,
    problem: over.problem ?? null,
    onPrepare: () => undefined,
    onDownload: () => undefined,
    onRetry: () => undefined,
  });

/** Кнопки сторінки: видимий підпис → чи вимкнена. */
function buttons(html: string): { text: string; disabled: boolean }[] {
  return [...html.matchAll(/<button\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    text: visibleText(m[2]),
    disabled: /(?:^|\s)disabled(?:=""|\s|$)/.test(m[1]),
  }));
}

const links = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    text: visibleText(m[2]),
  }));

test.describe('🔴 кожен стан архіву показує свої кнопки — і лише їх', () => {
  const EXPECT: Record<string, string[]> = {
    checking: [],
    none: ['Prepare my archive'],
    preparing: [],
    ready: ['Download (JSON)'],
    failed: ['Try again'],
    unreachable: ['Try again'],
    unavailable: [],
  };
  for (const [name, state] of STATES)
    test(`«${name}»: кнопки — ${JSON.stringify(EXPECT[name])}`, () => {
      expect(buttons(page(state)).map((b) => b.text)).toEqual(EXPECT[name]);
    });

  test('завантажити можна лише готовий архів: «Download» є в одному стані з семи', () => {
    const withDownload = STATES.filter(([, s]) =>
      buttons(page(s)).some((b) => b.text === 'Download (JSON)'),
    ).map(([n]) => n);
    expect(withDownload).toEqual(['ready']);
  });

  test('сторінка, що ще не ожила, і зайнята — не дають натиснути жодну кнопку', () => {
    for (const [, state] of STATES) {
      for (const over of [{ ready: false }, { busy: true }])
        for (const b of buttons(page(state, over))) expect(b.disabled, `${b.text} ${JSON.stringify(over)}`).toBe(true);
      // Контроль: у живому й вільному стані ті самі кнопки активні.
      for (const b of buttons(page(state))) expect(b.disabled, b.text).toBe(false);
    }
  });
});

test.describe('🔴 «архів готується» — справжній стан екрана', () => {
  const html = page({ kind: 'preparing' });

  test('є, і каже, що відбувається, у `role="status"`', () => {
    expect(html).toContain('role="status"');
    expect(visibleText(html)).toContain('Preparing your archive…');
  });

  test('каже правду про те, що можна піти: стан живе на сервері й чекатиме тут', () => {
    expect(visibleText(html)).toContain(
      'This page updates by itself. You can leave it: the archive keeps being prepared on our side and will be here when you come back.',
    );
  });

  test('не обіцяє тривалості, якої не заміряно, і не обіцяє листа', () => {
    expect(visibleText(html)).not.toMatch(/minute|usually|зазвичай/i);
    for (const [name, state] of STATES)
      expect(visibleText(page(state)), name).not.toMatch(/e-?mail|inbox/i);
  });

  test('у цьому стані немає ні кнопки «Prepare», ні «Download»', () => {
    expect(buttons(html)).toEqual([]);
  });
});

test.describe('готовий архів', () => {
  const html = page({ kind: 'ready', expiresAt: '2026-10-17T12:00:00.000Z' });

  test('називає, до якої миті його можна завантажити, і що потім', () => {
    expect(visibleText(html)).toContain(
      'Your archive is ready. You can download it until 17 October 2026, 12:00 UTC (24 hours after it was prepared); after that it is deleted.',
    );
  });
});

test.describe('помилки читаються словами, а не кольором', () => {
  test('«failed» — слово «Error», причина й «нічого не змінено»', () => {
    const html = page({ kind: 'failed' });
    expect(html).toContain('role="alert"');
    expect(visibleText(html)).toContain(
      'Error: We could not prepare your archive. Nothing was changed — try again.',
    );
  });

  test('«unreachable» — НЕ «не вийшло приготувати»: про архів нічого не відомо', () => {
    const text = visibleText(page({ kind: 'unreachable' }));
    expect(text).toContain('Error: We could not check on your archive. Nothing was changed — try again.');
    expect(text).not.toContain('could not prepare');
  });

  test('«unavailable» — без кнопки, бо ніщо не повторюється', () => {
    const html = page({ kind: 'unavailable' });
    expect(visibleText(html)).toContain('Error: Accounts are not available right now.');
    expect(buttons(html)).toEqual([]);
  });

  const PROBLEMS: [Exclude<DownloadProblem, null>, string][] = [
    ['gone', 'That archive is no longer available. Prepare a new one.'],
    ['throttled', 'Too many requests from this connection. Try again in a few minutes.'],
    ['failed', 'We could not download the file. Nothing was changed — try again.'],
  ];
  for (const [problem, message] of PROBLEMS)
    test(`завантаження: «${problem}»`, () => {
      const html = page({ kind: 'ready', expiresAt: '2026-10-17T12:00:00.000Z' }, { problem });
      expect(html).toContain('role="alert"');
      expect(visibleText(html)).toContain(`Error: ${message}`);
    });

  test('без проблеми блоку `alert` у готовому стані немає', () => {
    expect(page({ kind: 'ready', expiresAt: '2026-10-17T12:00:00.000Z' })).not.toContain('role="alert"');
  });
});

test.describe('вхід у видалення і решта сторінки', () => {
  const html = page({ kind: 'none' });

  test('є заголовок і підпис статті, і обидва блоки названі словами макета', () => {
    expect(DATA_TITLE).toBe('Your data');
    const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => visibleText(m[1]));
    expect(h1).toEqual([DATA_TITLE]);
    const text = visibleText(html);
    expect(text).toContain('GDPR · Articles 15 and 20');
    expect(text).toContain('Download my data');
    expect(text).toContain('GDPR · Article 17');
    expect(text).toContain('Delete my account');
  });

  test('опис файлу чесний: один JSON, без ZIP і без «фото в оригіналі», яких немає', () => {
    const text = visibleText(html);
    expect(text).toContain('One JSON file that both a person and a program can read');
    expect(text).not.toMatch(/\bzip\b|original/i);
  });

  test('видалення називає вікно й веде на екран, що існує', () => {
    expect(visibleText(html)).toContain(
      'Permanently — after a 30-day window in which you can change your mind.',
    );
    const toDelete = links(html).filter((l) => l.href === '/account/delete');
    expect(toDelete).toEqual([{ href: '/account/delete', text: 'Delete account…' }]);
    for (const l of links(html))
      expect(existsSync(join(__dirname, '..', '..', 'src', 'app', l.href, 'page.tsx')), l.href).toBe(true);
  });

  test('сторінка не віддає чужих полів: нічого, крім переданого стану', () => {
    const leaky = renderComponent(DataView, {
      archive: { kind: 'ready', expiresAt: '2026-10-17T12:00:00.000Z', file: 'LEAK' } as unknown as ArchiveState,
      busy: false,
      ready: true,
      problem: null,
      onPrepare: () => undefined,
      onDownload: () => undefined,
      onRetry: () => undefined,
    });
    expect(leaky).not.toContain('LEAK');
  });
});
