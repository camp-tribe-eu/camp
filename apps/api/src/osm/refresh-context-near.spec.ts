import { applyNear, freshOf, keysToTouch } from './refresh-context-near';
import type { SpotContext } from './spot-context';

// CAMP-296 — перерахунок міста, магазину й станції в уже збереженому
// контексті. Чиста функція, тож перевіряється без бази.
//
// 🔴 Кожен тест червонів на мутації, названій над ним.

const stored = (): SpotContext => ({
  at: { lat: 54.3, lon: 21.4 },
  water: { m: 1200, kind: 'lake', name: 'Lake X' },
  town: { m: 13000, name: 'Kaliningrad-side' },
  supermarket: { m: 4000, name: 'Shop A' },
  station: { m: 9000, name: 'Station A' },
  elevation: 120,
  terrain: { relief: 40, type: 'rolling' },
});

describe('applyNear', () => {
  // 🔴 MUTATION: зробити `same()` завжди істинною — нічого не міняється, а
  // сторінка й далі каже «13 км».
  it('замінює місто на те, що в ЄС-27, і каже, що змінилось', () => {
    const { next, changed } = applyNear(stored(), {
      town: { m: 31000, name: 'Bartoszyce' },
      supermarket: { m: 4000, name: 'Shop A' },
      station: { m: 9000, name: 'Station A' },
    });
    expect(next.town).toEqual({ m: 31000, name: 'Bartoszyce' });
    expect(changed).toEqual(['town']);
  });

  // 🔴 MUTATION: у `next` покласти лише три ключі замість `{ ...context }`.
  // Висота коштувала дев'ять запитів до Open-Meteo, а вода від зміни не
  // залежить — не їм тут вмирати.
  it('не чіпає ні води, ні висоти, ні рельєфу, ні `at`', () => {
    const before = stored();
    const { next } = applyNear(before, {
      town: { m: 31000 },
      supermarket: { m: 4000, name: 'Shop A' },
      station: { m: 9000, name: 'Station A' },
    });
    expect(next.water).toEqual(before.water);
    expect(next.elevation).toBe(120);
    expect(next.terrain).toEqual(before.terrain);
    expect(next.at).toEqual(before.at);
  });

  // 🔴 «Порожнє не малюємо». MUTATION: не видаляти ключ, коли свіжого немає —
  // тоді місто в Росії лишається на сторінці, бо «нічого кращого нема».
  it('прибирає ключ, якщо в ЄС-27 для кемпінгу об’єкта немає зовсім', () => {
    const { next, removed } = applyNear(stored(), {
      supermarket: { m: 4000, name: 'Shop A' },
      station: { m: 9000, name: 'Station A' },
    });
    expect('town' in next).toBe(false);
    expect(removed).toEqual(['town']);
  });

  // 🔴 MUTATION: порівнювати лише `m`. Інше місто на тій самій відстані — теж
  // зміна.
  it('розрізняє об’єкти на однаковій відстані за назвою', () => {
    const { changed } = applyNear(stored(), {
      town: { m: 13000, name: 'Другий' },
      supermarket: { m: 4000, name: 'Shop A' },
      station: { m: 9000, name: 'Station A' },
    });
    expect(changed).toEqual(['town']);
  });

  // 🔴 Ідемпотентність: другий прогін нічого не міняє.
  it('другий прогін по вже виправленому нічого не змінює', () => {
    const fresh = {
      town: { m: 31000, name: 'Bartoszyce' },
      supermarket: { m: 4000, name: 'Shop A' },
      station: { m: 9000, name: 'Station A' },
    };
    const once = applyNear(stored(), fresh);
    const twice = applyNear(once.next, fresh);
    expect(twice.changed).toEqual([]);
    expect(twice.next).toEqual(once.next);
  });

  // 🔴 MUTATION: повертати `{ at }` замість `{}`. Контекст лише з `at`
  // непорожній і зняв би noindex із сторінки, на якій нічого не лишилось
  // казати (CAMP-105).
  it('якщо після зміни казати нічого, контекст стає `{}`, а не `{ at }`', () => {
    const only: SpotContext = {
      at: { lat: 1, lon: 2 },
      town: { m: 13000, name: 'X' },
    };
    const { next, emptied } = applyNear(only, {});
    expect(next).toEqual({});
    expect(emptied).toBe(true);
  });

  it('не рахує контекст порожнім, коли лишилась висота', () => {
    const { next, emptied } = applyNear(
      { at: { lat: 1, lon: 2 }, town: { m: 1 }, elevation: 5 },
      {},
    );
    expect(emptied).toBe(false);
    expect(next.elevation).toBe(5);
  });
});

describe('freshOf', () => {
  const row = {
    id: 'x',
    slug: 'x',
    context: null,
    town_m: 13000,
    town_name: 'Крылово',
    shop_m: 4000,
    shop_name: 'Lidl',
    rail_m: null,
    rail_name: null,
  };

  // CAMP-295: назва, якої не передати латиницею, не показується, а відстань
  // лишається. Свіжа відповідь має ту саму форму, що й збережена, — інакше
  // кожна така назва виглядала б як «зміна».
  it('проводить назви через displayName і пропускає порожнє', () => {
    expect(freshOf(row)).toEqual({
      town: { m: 13000 },
      supermarket: { m: 4000, name: 'Lidl' },
    });
  });
});

describe('applyNear: only', () => {
  // 🔴 MUTATION: у циклі ходити по KEYS, а не по `only`. Тоді «лише те, що
  // змінила умова» чіпало б і розбіжності, яких умова не робила.
  it('чіпає лише названі ключі, решту лишає як є', () => {
    const { next, changed } = applyNear(
      stored(),
      {
        town: { m: 31000, name: 'Bartoszyce' },
        supermarket: { m: 1, name: 'Інший' },
        station: { m: 2, name: 'Інша' },
      },
      ['town'],
    );
    expect(changed).toEqual(['town']);
    expect(next.supermarket).toEqual(stored().supermarket);
    expect(next.station).toEqual(stored().station);
  });
});

describe('keysToTouch', () => {
  const legacy = {
    town: { m: 13000 },
    supermarket: { m: 4000, name: 'Shop A' },
    station: { m: 9000, name: 'Station A' },
  };
  const filtered = {
    town: { m: 31000, name: 'Bartoszyce' },
    supermarket: { m: 4000, name: 'Shop A' },
    station: { m: 9000, name: 'Station A' },
  };

  // 🔴 MUTATION: повертати завжди всі три ключі. Тоді скрипт без прапорця
  // переписував би й тисячу кемпінгів, чиє збережене просто відстає від шарів.
  it('без --with-drift — лише ключі, де умова міняє відповідь', () => {
    expect(keysToTouch(legacy, filtered, false)).toEqual(['town']);
  });

  it('з --with-drift — усі три', () => {
    expect(keysToTouch(legacy, filtered, true)).toEqual([
      'town',
      'supermarket',
      'station',
    ]);
  });

  // 🔴 MUTATION: порівнювати лише `m`. Інше місто на тій самій відстані —
  // теж зміна, зроблена умовою.
  it('розрізняє об’єкти на однаковій відстані за назвою', () => {
    expect(
      keysToTouch(
        { town: { m: 1, name: 'A' } },
        { town: { m: 1, name: 'B' } },
        false,
      ),
    ).toEqual(['town']);
  });

  // Ключ, якого в ЄС-27 немає зовсім, — теж зміна умови.
  it('рахує зникнення ключа зміною', () => {
    expect(keysToTouch({ town: { m: 1 } }, {}, false)).toEqual(['town']);
  });
});
