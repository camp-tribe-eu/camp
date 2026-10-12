import { rewriteNames } from './backfill-context-names';

// CAMP-295 — backfill назв у вже обчисленому `context`.
describe('rewriteNames', () => {
  it('транслітерує назву й рахує зміну', () => {
    const { next, changed, dropped } = rewriteNames({
      at: { lat: 1, lon: 2 },
      town: { m: 1300, name: 'Сапарева баня' },
    });
    expect(next.town).toEqual({ m: 1300, name: 'Sapareva banya' });
    expect([changed, dropped]).toEqual([1, 0]);
  });

  it('🔴 прибирає назву, яку не передати латиницею, і лишає відстань', () => {
    const { next, dropped } = rewriteNames({
      town: { m: 13000, name: 'Крылово' },
    });
    // Відстань — корисна й без назви: «the nearest town is 13 km away».
    expect(next.town).toEqual({ m: 13000 });
    expect(dropped).toBe(1);
  });

  it('не чіпає того, що вже латиницею', () => {
    const before = {
      town: { m: 1, name: 'Burgenland' },
      water: { m: 2, kind: 'lake', name: 'Watten – Éperlecques' },
    };
    const { next, changed, dropped } = rewriteNames(before);
    expect(next).toEqual(before);
    expect([changed, dropped]).toEqual([0, 0]);
  });

  it('🔴 ідемпотентний: другий прогін нічого не змінює', () => {
    const once = rewriteNames({ town: { m: 1, name: 'Шумен' } });
    const twice = rewriteNames(once.next);
    expect(twice.changed + twice.dropped).toBe(0);
    expect(twice.next).toEqual(once.next);
  });

  it('не падає на вузлах без назви й на чужих полях', () => {
    const { next, changed, dropped } = rewriteNames({
      at: { lat: 1, lon: 2 },
      town: { m: 5 },
      elevation: 300,
      terrain: { relief: 40, type: 'rolling' },
    });
    expect(next.town).toEqual({ m: 5 });
    expect(next.elevation).toBe(300);
    expect([changed, dropped]).toEqual([0, 0]);
  });

  it('обробляє всі чотири поля, а не лише місто', () => {
    const { changed } = rewriteNames({
      town: { m: 1, name: 'Шумен' },
      water: { m: 2, name: 'Плевен' },
      supermarket: { m: 3, name: 'Шумен' },
      station: { m: 4, name: 'Шумен' },
    });
    expect(changed).toBe(4);
  });
});
