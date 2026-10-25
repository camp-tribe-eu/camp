import { expect, test } from '@playwright/test';
import {
  CONSENT_SOURCES,
  WORDINGS,
  WORDING_KEYS,
  currentWording,
  type ConsentSource,
} from '../../../api/src/consent/wordings';
import { SignupForm } from '@/components/account-forms';
import { LettersCard, SettingsView } from '@/components/account-settings-view';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-390 — СТОРОЖ ПРОТИ РОЗХОДЖЕННЯ ДВОХ КОПІЙ ТЕКСТУ ЗГОДИ.
//
// Текст біля галочки живе у двох місцях: у компоненті (його бачить людина) і в
// реєстрі API (`apps/api/src/consent/wordings.ts`, його ім'я пише в журнал).
// Розійдуться мовчки — і журнал доводитиме згоду на текст, якого людина не
// бачила (ст. 7(1) GDPR).
//
// 🔴 ЦЕЙ ТЕСТ ЧИТАЄ ВИДАНУ HTML, не константу, не клас, не `sr-only`: компонент
// віддається в розмітку, з неї береться видимий підпис кожного checkbox, і саме
// він порівнюється з реєстром. Тест, який порівнював би реєстр із рядком, що
// його експортує компонент, порівнював би реєстр зі своєю ж копією.
//
// 🔴 ДВА НАПРЯМКИ. (1) Кожен текст реєстру мусить знайтись на своєму екрані
// дослівно. (2) Кожна галочка на екрані згод мусить бути в реєстрі: інакше
// нова галочка (чи нова згода) тихо лишалась би без журналу.
//
// 🔴 «НЕМАЄ ЕКРАНА» — ЦЕ ПРОВАЛ, А НЕ ПРОПУСК. Запис реєстру, для якого тут
// немає екрана, червонить тест: формулювання без перевірки не додається тихо.
// Саме тому тут немає фото-згод: їхнього тексту й екрана ще не існує
// (див. шапку `wordings.ts`).
//
// Версію тексту стереже окремо `consent-wordings.spec.ts` в API: змінити текст
// ВСЮДИ без нової версії — теж розходження, тільки з боку часу.

type Tag = Record<string, string | true>;

const attrsOf = (raw: string): Tag => {
  const out: Tag = {};
  for (const a of raw.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) out[a[1]] = a[2] ?? true;
  return out;
};

type Box = { name: string | undefined; checked: boolean; label: string | null };

/**
 * Кожен checkbox виданої HTML з його видимим підписом: або `<label for=id>`, або
 * `<label>`, що містить сам checkbox. `label: null` — галочка без підпису, і
 * вона нічого не доводить, тож порівняння з реєстром її не пропустить.
 */
function checkboxes(html: string): Box[] {
  const inputs = [...html.matchAll(/<input\b([^>]*)>/g)]
    .map((m) => ({ raw: m[0], attrs: attrsOf(m[1]) }))
    .filter((i) => i.attrs.type === 'checkbox');
  const labels = [...html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)].map((m) => ({
    attrs: attrsOf(m[1]),
    inner: m[2],
  }));
  return inputs.map(({ raw, attrs }) => {
    const hit =
      labels.find((l) => attrs.id !== undefined && l.attrs.for === attrs.id) ??
      labels.find((l) => l.inner.includes(raw));
    return {
      name: typeof attrs.name === 'string' ? attrs.name : undefined,
      checked: 'checked' in attrs,
      label: hit ? visibleText(hit.inner) : null,
    };
  });
}

const noop = () => undefined;

/**
 * Екрани, на яких стоїть галочка згоди, — ті самі компоненти, що їх бачить
 * людина, у початковому стані. Ключ — `source` формулювання.
 */
const SCREENS: Partial<Record<ConsentSource, () => string>> = {
  // Цілою формою, з її початковим станом: саме його Next пререндерить у HTML.
  signup: () => renderComponent(() => <SignupForm />, {}),
  settings: () =>
    renderComponent(SettingsView, {
      email: {
        current: 'anna@example.com',
        verified: true,
        value: '',
        password: '',
        busy: false,
        note: null,
        onEdit: noop,
        onPassword: noop,
        onSubmit: noop,
      },
      password: {
        current: '',
        next: '',
        busy: false,
        note: null,
        onCurrent: noop,
        onNext: noop,
        onSubmit: noop,
      },
      // Вимкнено, бо так перемикач виглядає, поки людина сама не ввімкнула.
      letters: { on: false, busy: false, note: null, onToggle: noop },
    }),
};

const screenOf = (source: ConsentSource): string => {
  const render = SCREENS[source];
  if (!render)
    throw new Error(
      `Для джерела "${source}" немає екрана в SCREENS: формулювання без перевірки не додається. ` +
        'Додайте сюди компонент, що його показує.',
    );
  return render();
};

test.describe('🔴 (1) кожен текст реєстру стоїть на своєму екрані дослівно', () => {
  // Один тест на ключ: новий ключ — новий тест, і червоний, поки його не знайдуть.
  for (const key of WORDING_KEYS) {
    test(`${key}: підпис галочки у виданій HTML = чинна версія реєстру`, () => {
      const w = currentWording(key);
      const boxes = checkboxes(screenOf(w.source));
      const labels = boxes.map((b) => b.label);
      // Рівно одна галочка з цим текстом на екрані: ні нуль, ні дві.
      expect(
        labels.filter((l) => l === w.text),
        `на екрані «${w.source}» немає галочки з текстом реєстру (${key}@${w.version}).\n` +
          `Реєстр:  ${JSON.stringify(w.text)}\nНа екрані: ${JSON.stringify(labels)}`,
      ).toHaveLength(1);
    });
  }

  test('реєстр не порожній — інакше цикл вище не створив жодного тесту', () => {
    expect(WORDING_KEYS.length).toBeGreaterThanOrEqual(2);
  });

  test('усі джерела з реєстру мають екран, а екрани — джерело', () => {
    for (const w of WORDINGS) expect(Object.keys(SCREENS), w.key).toContain(w.source);
    for (const s of Object.keys(SCREENS)) expect(CONSENT_SOURCES as readonly string[]).toContain(s);
  });
});

test.describe('🔴 (2) кожна галочка на екрані згод — у реєстрі', () => {
  for (const source of Object.keys(SCREENS) as ConsentSource[]) {
    test(`екран «${source}»: жодної галочки без формулювання в реєстрі`, () => {
      const boxes = checkboxes(screenOf(source));
      // Спершу — що галочки взагалі знайдено: порожній екран задовольнив би все нижче.
      expect(boxes.length).toBeGreaterThanOrEqual(1);
      const registered = WORDING_KEYS.map(currentWording)
        .filter((w) => w.source === source)
        .map((w) => w.text);
      for (const b of boxes) {
        expect(b.label, `галочка «${b.name}» без видимого підпису`).not.toBeNull();
        expect(
          registered,
          `галочка «${b.name}» на екрані «${source}» має текст, якого немає в реєстрі: ${JSON.stringify(b.label)}`,
        ).toContain(b.label);
      }
      // І нічого зайвого: стільки галочок, скільки формулювань.
      expect(boxes).toHaveLength(registered.length);
    });
  }
});

test.describe('сторож бачить те, про що каже', () => {
  test('читає і `<label for>`, і `<label>` навколо checkbox', () => {
    const forLabel = '<input id="a" type="checkbox" name="x"><label for="a">One <b>two</b></label>';
    const wrapped = '<label class="c"><input type="checkbox" name="y" checked=""><span>Three  four</span></label>';
    expect(checkboxes(forLabel)).toEqual([{ name: 'x', checked: false, label: 'One two' }]);
    expect(checkboxes(wrapped)).toEqual([{ name: 'y', checked: true, label: 'Three four' }]);
  });

  test('галочку без підпису не зараховує підписаною', () => {
    expect(checkboxes('<input type="checkbox" name="z">')).toEqual([
      { name: 'z', checked: false, label: null },
    ]);
  });

  test('розбіжність в один символ — червоне порівняння, а не збіг', () => {
    const w = currentWording('newsletter.signup');
    const shown = checkboxes(screenOf('signup')).map((b) => b.label);
    expect(shown).toContain(w.text);
    // Правки, що не залежать від того, які слова стоять у тексті сьогодні.
    expect(shown).not.toContain(w.text.slice(0, -1));
    expect(shown).not.toContain(w.text + ' really');
    expect(shown).not.toContain(w.text.toUpperCase());
  });

  test('екран згоди в налаштуваннях і справді віддає галочку, вимкнену початково', () => {
    const html = renderComponent(LettersCard, { on: false, busy: false, note: null, onToggle: noop });
    const [box] = checkboxes(html);
    expect(box.checked).toBe(false);
    expect(box.label).toBe(currentWording('newsletter.settings').text);
    // …а ввімкнений стан у тій самій розмітці зʼявляється, тож відсутність щось означає.
    const on = renderComponent(LettersCard, { on: true, busy: false, note: null, onToggle: noop });
    expect(checkboxes(on)[0].checked).toBe(true);
  });
});
