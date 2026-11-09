import { expect, test } from '@playwright/test';

import Checkbox from '@/components/checkbox';
import RouteLibrary from '@/components/route-library';
import { renderClient, renderComponent } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-459 — чекбокси, яких видно до кліку.
 *
 * Власник на знімках 443/11–443/20: «Тут взагалі не зрозуміло що це
 * чекбокси поки я не натиснув!» На `/routes` фільтри були пігулками з
 * `aria-pressed`: та сама рамка до й після вибору, різниця лише в
 * кольорі тла.
 *
 * 🔴 ЩО САМЕ ТУТ ДОВОДИТЬСЯ. Не «є клас», а ВЛАСТИВІСТЬ, якої бракувало:
 * квадрат малюється в ОБОХ станах, а галочка — лише у вибраному. Тому
 * розмітка невибраного й вибраного рендериться й ПОРІВНЮЄТЬСЯ, а не
 * перевіряється поодинці.
 *
 * 🔴 МУТАЦІЇ, ЯКІ ЦЕЙ ФАЙЛ МУСИТЬ ЧЕРВОНИТИ (прогнано 09.11.2026):
 *  · прибрати `.ct-cb__box` із розмітки → падає «квадрат є в обох станах»;
 *  · показати галочку завжди (`svg{opacity:1}`) → падає «галочка лише у
 *    вибраному»;
 *  · повернути пігулки у фільтри країн → падає «фільтри /routes — це
 *    чекбокси».
 */

const box = (html: string) => (html.match(/class="ct-cb__box"/g) ?? []).length;

test.describe('CAMP-459: квадрат видно завжди, галочка — ні', () => {
  const off = () =>
    renderComponent(Checkbox, { checked: false, onChange: () => {}, children: 'France' });
  const on = () =>
    renderComponent(Checkbox, { checked: true, onChange: () => {}, children: 'France' });

  test('🔴 квадрат є в ОБОХ станах — саме цього бракувало', () => {
    expect(box(off()), 'невибраний чекбокс не малює квадрата').toBe(1);
    expect(box(on()), 'вибраний чекбокс не малює квадрата').toBe(1);
  });

  test('🔴 галочка в розмітці є завжди, а показує її лише `:checked`', () => {
    // Обидва стани несуть `<svg>`: перемикання робить CSS, не React, —
    // інакше воно б не працювало без JS, заради чого й узято нативний
    // `<input>`.
    expect(off()).toContain('<svg');
    expect(on()).toContain('<svg');
    // І правило, яке її ховає, їде разом із компонентом.
    expect(off(), 'галочку не сховано в невибраному стані').toContain(
      '.ct-cb__box svg{opacity:0',
    );
    expect(off(), 'немає правила, яке показує галочку при виборі').toContain(
      '.ct-cb__input:checked + .ct-cb__box svg{opacity:1',
    );
  });

  test('🔴 рамка квадрата — токен контролю, а не декоративна лінія', () => {
    // `--color-line` дає проти тла 1.30–1.71 при потрібних 3:1
    // (WCAG 1.4.11). Якщо хтось «спростить» токен назад, квадрат знову
    // стане невидимим — тим самим дефектом, через який є ця картка.
    expect(off()).toContain('border:1px solid var(--color-control-line)');
    expect(off(), 'рамка повернулась до декоративної лінії').not.toContain(
      'border:1px solid var(--color-line)',
    );
  });

  test('стан несе нативний input, а не роль на span', () => {
    expect(off()).toContain('type="checkbox"');
    expect(on()).toContain('checked');
    expect(off(), 'квадрат озвучується читачем двічі').toContain('aria-hidden="true"');
  });

  test('напис лишається читабельним текстом', () => {
    expect(visibleText(off())).toContain('France');
  });
});

test.describe('CAMP-459: фільтри /routes', () => {
  // 🔴 Фікстура повна, а не «аби компілювалось»: перша редакція
  // вигадала поля (`title`, `tags`, `km`) і впала на `r.suits is not
  // iterable`. Форма береться з `RouteCard`, тож тест ламається тоді,
  // коли ламається контракт, а не коли я щось не дописав.
  const routes: Parameters<typeof RouteLibrary>[0]['routes'] = [
    {
      slug: 'alps',
      name: 'Alps',
      summary: 'A route',
      region: 'Savoie',
      countries: ['fr'],
      countryNames: ['France'],
      days: 5,
      nights: 4,
      months: [7],
      monthsLabel: 'July',
      suits: ['families'],
      distance: '500 km in a straight line',
    },
  ];

  test('🔴 країни й «кому підходить» — це чекбокси, а не пігулки', () => {
    // 🔴 `renderClient`, а не `renderComponent`: `RouteLibrary` тримає
    // стан на `useState`, а `renderComponent` кличе функцію напряму —
    // гачки там не живуть.
    const html = renderClient(RouteLibrary, { routes });
    expect(html, 'у фільтрі країн немає жодного чекбокса').toContain(
      'data-testid="route-filter-country-fr"',
    );
    expect(box(html), 'квадратів менше, ніж фільтрів').toBeGreaterThan(0);
    // Група називає себе — інакше читач екрана чує «France, checkbox».
    expect(html).toContain('<fieldset>');
    expect(html).toContain('<legend');
  });

  test('сезон лишається «одним із» і каже про це словами', () => {
    // Квадрат із галочкою на виборі «один із» обіцяв би, що можна взяти
    // кілька. Радіо в темі немає, тож група пояснює себе текстом.
    const text = visibleText(renderClient(RouteLibrary, { routes }));
    expect(text).toContain('choose one');
  });
});
