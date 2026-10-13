import {
  adopt,
  ageMinutes,
  countShapes,
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

  it('порожній перелік країн не вважається повним провалом', () => {
    // 0 >= 0 було б істинним і заморозило б знімок назавжди.
    expect(adopt(old, fresh, { countries: 0, failed: 0 })).toBe(fresh);
  });
});
