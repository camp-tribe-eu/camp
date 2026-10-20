import { buildNavTree, type NavRow } from './navigation.service';

// CAMP-365 — дерево меню. Цей файл існує через дефект, який я сам
// заклав і сам же обґрунтував неправильно.
//
// 🔴 Перша редакція робила кореневим пункт, чий батько не потрапив у
// вибірку: «інакше він зник би мовчки разом із батьком». Звучить
// турботливо. Наслідок протилежний: батько випадає з вибірки саме
// тоді, коли власник зняв `visible` або не переклав підпис. Тобто
// ХОВАЮЧИ розділ, власник ОПУБЛІКУВАВ би всі його підпункти — поруч із
// головними, верхнім рівнем.

const row = (id: string, href: string, parent: string | null = null): NavRow => ({
  id,
  parent_id: parent,
  href,
  label: href.replace('/', '') || 'home',
});

describe('buildNavTree', () => {
  it('🔴 прихований батько ховає ВСЮ гілку, а не публікує її', () => {
    // Батька (`g`) у вибірці немає — запит його відсіяв через
    // visible = false або порожній підпис.
    const tree = buildNavTree([
      row('1', '/map'),
      row('2', '/guides/fr', 'g'),
      row('3', '/guides/it', 'g'),
    ]);

    expect(tree.map((n) => n.href)).toEqual(['/map']);
  });

  it('дітей віддає під батьком, у порядку рядків', () => {
    const tree = buildNavTree([
      row('g', '/guides'),
      row('2', '/guides/fr', 'g'),
      row('3', '/guides/it', 'g'),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].href).toBe('/guides');
    expect(tree[0].children.map((c) => c.href)).toEqual([
      '/guides/fr',
      '/guides/it',
    ]);
  });

  // 🔴 ПАРА ДО ОБОХ ТВЕРДЖЕНЬ ВИЩЕ. «Гілка схована» і «дітей віддано
  // під батьком» обидва істинні над порожнім деревом, тож без цього
  // випадку мутація «повертати []» лишилась би живою.
  it('корені без батька лишаються коренями', () => {
    const tree = buildNavTree([row('1', '/map'), row('2', '/camping')]);
    expect(tree.map((n) => n.href)).toEqual(['/map', '/camping']);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it('цикл у батьківстві не вішає побудову', () => {
    // a → b → a. Обидва мають батька у вибірці, тож обидва підуть у
    // дітей, а коренів не буде зовсім. Головне — що функція ПОВЕРНЕТЬСЯ.
    const tree = buildNavTree([
      { id: 'a', parent_id: 'b', href: '/a', label: 'a' },
      { id: 'b', parent_id: 'a', href: '/b', label: 'b' },
    ]);
    expect(tree).toEqual([]);
  });
});
