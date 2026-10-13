import {
  adopt,
  ageMinutes,
  coordinatesIn,
  countShapes,
  safeId,
  withoutGeometry,
  type Warning,
} from './snapshot';

const area = (over: Partial<Warning['areas'][number]> = {}) => ({
  name: 'Attiki',
  codes: ['NUTS3:EL303'],
  polygons: ['37.9,23.7 38.0,23.8'],
  circles: ['37.9,23.7 12'],
  ...over,
});

const warning = (areas = [area()]): Warning => ({
  event: 'Fog',
  sender: 'EMY',
  areas,
});

describe('CAMP-302: що їде читачеві', () => {
  it('🔴 геометрія не лишається ЖОДНА', () => {
    const out = withoutGeometry([warning(), warning([area(), area()])]);
    expect(countShapes(out)).toBe(0);
  });

  it('🔴 а коди й назви лишаються — без них попередження нічим розмістити', () => {
    const out = withoutGeometry([warning()]);
    expect(out[0].areas[0].codes).toEqual(['NUTS3:EL303']);
    expect(out[0].areas[0].name).toBe('Attiki');
  });

  it('решта полів попередження не чіпається', () => {
    const out = withoutGeometry([warning()]);
    expect(out[0].event).toBe('Fog');
    expect(out[0].sender).toBe('EMY');
  });

  it('вхід не мутується — знімок у памʼяті лишається цілим', () => {
    const src = [warning()];
    withoutGeometry(src);
    expect(src[0].areas[0].polygons).toHaveLength(1);
  });

  it('попередження без зон не падає', () => {
    expect(withoutGeometry([{ areas: [] }])).toEqual([{ areas: [] }]);
  });

  it('🔴 лічильник бачить і кола, і полігони окремо', () => {
    // Інакше «нуль фігур» могло б означати «нуль полігонів, а кола є».
    expect(countShapes([warning([area({ circles: [] })])])).toBe(1);
    expect(countShapes([warning([area({ polygons: [] })])])).toBe(1);
    expect(
      countShapes([warning([area({ polygons: ['a', 'b'], circles: ['c'] })])]),
    ).toBe(3);
  });

  it('вік рахується від часу ЗНІМКА', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    expect(
      ageMinutes({ fetchedAt: '2026-10-13T11:52:00Z', warnings: [] }, now),
    ).toBe(8);
    expect(ageMinutes({ fetchedAt: null, warnings: [] }, now)).toBeNull();
    expect(ageMinutes({ fetchedAt: 'не дата', warnings: [] }, now)).toBeNull();
  });
});

describe('CAMP-302: який знімок лишається після обороту', () => {
  const old = { fetchedAt: '2026-10-13T11:00:00Z', warnings: [warning()] };
  const fresh = {
    fetchedAt: '2026-10-13T12:00:00Z',
    warnings: [warning(), warning()],
  };

  it('🔴 усі фіди мовчать — лишається СТАРИЙ знімок зі своїм часом', () => {
    // Інакше панель сказала б «попереджень немає» зі свіжою міткою
    // часу. «Ми не знаємо» і «нічого немає» — різні речення, і вся
    // користь цього шару саме в різниці між ними.
    expect(adopt(old, fresh, { countries: 27, failed: 27 })).toBe(old);
  });

  it('🔴 три з 27 мовчать — беремо свіжий, бо 24 відповіли', () => {
    expect(adopt(old, fresh, { countries: 27, failed: 3 })).toBe(fresh);
  });

  it('усі відповіли — беремо свіжий', () => {
    expect(adopt(old, fresh, { countries: 27, failed: 0 })).toBe(fresh);
  });

  it('🔴 порожній перелік країн — ЗБІЙ, а не «нема кого питати»', () => {
    // Перша редакція благословляла `countries: 0 → fresh`, тобто
    // публікувала порожнечу, щойно фетчер віддав порожній перелік.
    // Рецензія це заміряла.
    expect(adopt(old, fresh, { countries: 0, failed: 0 })).toBe(old);
  });

  it('🔴 «усі відповіли 200, і нічого не вийшло» — теж збій', () => {
    expect(
      adopt(old, fresh, { countries: 27, failed: 0, looksBroken: true }),
    ).toBe(old);
  });
});

describe('🔴 CAMP-302: геометрія там, куди я не дивився', () => {
  // Рецензія знайшла її в `id`. Фетчер будує ключ як
  // `identifier|codes.join('+') || polygons.join('+')`, тож для зони БЕЗ
  // кодів у `id` запікається сирий полігон — ще до того, як
  // `withoutGeometry` щось почистить. Заміряно на живих фідах: Швеція
  // 81% тіла відповіді, Естонія 69.5%. Це ті самі країни без кодів.

  const codeless = {
    id: '2.49.0.0.250.0.SE.123|58.6,25.7 58.7,25.8 58.9,25.9',
    areas: [
      {
        name: 'Norrbotten',
        codes: [],
        polygons: ['58.6,25.7 58.7,25.8'],
        circles: [],
      },
    ],
  };

  it('🔴 `countShapes` казав НУЛЬ, коли 81% відповіді — координати', () => {
    const served = withoutGeometry([codeless]);
    // Стара перевірка погоджувалась сама з собою: вона сумувала рівно
    // ті два поля, які чистить `withoutGeometry`.
    expect(countShapes(served)).toBe(0);
    // А ця дивиться на те, що побачить читач.
    expect(coordinatesIn(served)).toBe(0);
  });

  it('🔴 і без виправлення вона б це побачила', () => {
    // Доказ, що нова перевірка справді ловить: той самий вхід без
    // очищення `id`.
    expect(coordinatesIn([codeless])).toBeGreaterThan(0);
  });

  it('`id` лишається унікальним — різні полігони дають різні ключі', () => {
    const a = safeId('X|58.6,25.7 58.7,25.8');
    const b = safeId('X|59.1,26.2 59.3,26.4');
    expect(a).not.toBe(b);
    expect(a.startsWith('X|geo:')).toBe(true);
  });

  it('`id` без координат не чіпається', () => {
    expect(safeId('2.49.0.0.250.0.FR.1|NUTS3:FR815')).toBe(
      '2.49.0.0.250.0.FR.1|NUTS3:FR815',
    );
  });

  it('🔴 лічильник координат не бачить звичайних чисел', () => {
    // Інакше він червонів би на кожному `expires` чи `severity`.
    expect(coordinatesIn([{ areas: [], seen: 6066, version: '1.2' }])).toBe(0);
  });
});
