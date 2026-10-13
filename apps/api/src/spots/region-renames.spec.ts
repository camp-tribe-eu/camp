import {
  REGIONS_IN_USE_SQL,
  regionRenames,
  type RegionRow,
} from './region-renames';

// 🔴 ЦЕЙ ФАЙЛ ІСНУЄ ТОМУ, ЩО ЙОГО НЕ БУЛО, І ЦЕ ЗНАЙШЛА РЕЦЕНЗІЯ.
//
// Мутація `regionRenames() { return []; }` проходила ВСЕ: 1419 тестів
// API, 18 веб-юнітів і крок CI, буквально названий «A region rename
// list is never legitimately empty». Бо всі десять випадків репетиції
// генератора міряли `verdict()` — валідатор ФОРМИ, який ніколи не
// бачив функції, що рахує правила.
//
// Тобто рівно та катастрофа, заради якої написана картка — 721 адреса
// віддає 404 — лишалась зеленою. Доказ мусить дивитись на обчислення,
// а не на його обгортку.

const row = (country: string, region: string, pages = 1): RegionRow => ({
  country,
  region,
  pages,
});

describe('CAMP-289: пари «стара адреса → нова»', () => {
  it('🔴 виправлена назва дає пару', () => {
    expect(regionRenames([row('FR', 'Haute-Rhin', 238)])).toEqual([
      { country: 'fr', from: 'haute-rhin', to: 'haut-rhin', pages: 238 },
    ]);
  });

  it('🔴 літера, яку NFD не розкладає, теж дає пару', () => {
    // Без цього DK лишився б на `sja-lland`, PL на `odz`, MT на `mellie-a`.
    expect(regionRenames([row('PL', 'Łódź', 41)])).toEqual([
      { country: 'pl', from: 'odz', to: 'lodz', pages: 41 },
    ]);
  });

  it('🔴 обидві причини разом — DK, найбільший випадок', () => {
    // `Sjaælland` → назву виправлено на `Sjælland`, і `æ` згорнуто.
    expect(regionRenames([row('DK', 'Sjaælland', 306)])).toEqual([
      { country: 'dk', from: 'sja-lland', to: 'sjaelland', pages: 306 },
    ]);
  });

  it('🔴 різниця лише в діакритиці пари НЕ дає', () => {
    // `Gyôr` і `Győr` обидва зводяться до `gyor`: адреса не рухається,
    // рухається лише назва на сторінці. Картка просила це заміряти, і
    // дві пари з девʼяти відпали саме тут.
    expect(regionRenames([row('HU', 'Gyôr', 3)])).toEqual([]);
    expect(regionRenames([row('HU', 'Hódmezôvásárhely', 1)])).toEqual([]);
  });

  it('правильна назва пари не дає', () => {
    expect(regionRenames([row('FR', 'Haut-Rhin', 100)])).toEqual([]);
    expect(regionRenames([row('SE', 'Skåne', 50)])).toEqual([]);
  });

  it('назва, з якої не лишається адреси, пари не дає', () => {
    // Порожній бік не можна ні звідки вести, ні кудись вести.
    expect(regionRenames([row('GR', '—— ——', 5)])).toEqual([]);
  });

  it('🔴 порожній вхід дає порожній вихід — і це НЕ привід для спокою', () => {
    // Сам по собі цей випадок нічого не доводить; він тут, щоб не
    // плутати «нема з чого рахувати» з «порахували й нічого немає».
    expect(regionRenames([])).toEqual([]);
  });

  it('усі вісім правил, як вони є на живій базі', () => {
    // 🔴 Заміряно 13.10.2026. Корпус — назви, які справді лежать у
    // `camping_spots`, тож цей випадок червоніє і тоді, коли зламається
    // згортання, і тоді, коли зникне таблиця виправлень.
    const live = [
      row('DK', 'Sjaælland', 306),
      row('FR', 'Haute-Rhin', 238),
      row('FR', 'Seien-et-Marne', 70),
      row('PL', 'Łódź', 41),
      row('IT', 'Oristrano', 32),
      row('IT', 'Crotene', 29),
      row('MT', 'Mellieħa', 3),
      row('IE', 'Laoighis', 2),
      // Поруч — ті, що пари не дають, інакше «вісім» нічого не варте.
      row('HU', 'Gyôr', 3),
      row('FR', 'Haut-Rhin', 100),
    ];
    const got = regionRenames(live);
    expect(got).toHaveLength(8);
    expect(got.map((r) => `${r.country}/${r.from}→${r.to}`)).toEqual([
      'dk/sja-lland→sjaelland',
      'fr/haute-rhin→haut-rhin',
      'fr/seien-et-marne→seine-et-marne',
      'ie/laoighis→laois',
      'it/crotene→crotone',
      'it/oristrano→oristano',
      'mt/mellie-a→mellieha',
      'pl/odz→lodz',
    ]);
    // Сума — з чисел самої фікстури: перевіряємо, що сторінки
    // додаються, а не губляться. 🔴 Заміряно на живій базі окремо:
    // рядків у цих регіонах 762, живих 721, а власну СТОРІНКУ мають
    // 668 — решта вторинні. «721 сторінка» в першій редакції картки
    // була неточністю, яку знайшла рецензія.
    expect(got.reduce((n, r) => n + r.pages, 0)).toBe(721);
  });

  it('порядок стабільний, інакше згенерований файл шумить у кожному дифі', () => {
    const a = regionRenames([row('IT', 'Crotene'), row('DK', 'Sjaælland')]);
    const b = regionRenames([row('DK', 'Sjaælland'), row('IT', 'Crotene')]);
    expect(a).toEqual(b);
  });

  it('🔴 два написання з однаковим старим слагом і РІЗНИМ новим — це збій', () => {
    // Мовчки вибрати перше означало б відправити частину читачів не
    // туди. Рецензія це заміряла: дублів сьогодні нуль, сторожа не було.
    // Обидва написання дають старий слаг `haute-rhin`, а виправляч
    // веде їх у різні місця. У справжній таблиці такого сьогодні немає
    // — тому вона підставляється.
    const twoWays = (_c: string, r: string) =>
      r === 'Haute-Rhin' ? 'Haut-Rhin' : 'Haute Rhone';
    expect(() =>
      regionRenames(
        [row('FR', 'Haute-Rhin'), row('FR', 'Haute_Rhin')],
        twoWays,
      ),
    ).toThrow(/дві адреси для fr\/haute-rhin/);

    // Однакове призначення — не збій: сторінки просто додаються.
    const same = regionRenames([
      row('FR', 'Haute-Rhin', 2),
      row('FR', 'Haute-Rhin', 3),
    ]);
    expect(same).toHaveLength(1);
    expect(same[0].pages).toBe(5);
  });

  it('запит бере регіони незалежно від того, чи живі рядки', () => {
    // 🔴 `missing_since IS NULL` тут стояв і був пасткою: коли в
    // перейменованого регіону зникне останній живий рядок, правило
    // щезло б, і стара адреса віддала б 404 замість 410.
    expect(REGIONS_IN_USE_SQL).not.toContain('missing_since IS NULL');
    expect(REGIONS_IN_USE_SQL).toContain('region IS NOT NULL');
  });
});
