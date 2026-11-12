import {
  AMENITY_KEYS,
  MAX_NAME,
  WRITABLE,
  faults,
  merge,
} from './owner-overrides';

// CAMP-51 / CAMP-86 — що підтверджений власник має право виправити.

describe('що взагалі приймається', () => {
  it('назва і зручності — так', () => {
    expect(faults({ name: 'Alpenblick' })).toEqual([]);
    expect(faults({ amenities: { shower: 'yes' } })).toEqual([]);
    expect(faults({ name: 'A', amenities: { wifi: 'no' } })).toEqual([]);
  });

  it('🔴 зайве поле — ВІДМОВА, а не тихе ігнорування', () => {
    // Мовчки викинуте поле виглядає для того, хто його надіслав, точно
    // як збережене. Той самий вибір, що в «Report a problem».
    expect(faults({ name: 'A', website: 'https://x.invalid' })).toEqual([
      'поле «website» власник не редагує — сторінка його не показує',
    ]);
    expect(faults({ location: { lat: 1 } }).length).toBeGreaterThan(0);
    expect(faults({ type: 'paid' }).length).toBeGreaterThan(0);
  });

  it('порожня правка — відмова', () => {
    expect(faults({})).toEqual(['порожня правка — нема чого зберігати']);
  });

  it('не об’єкт — відмова, а не аварія', () => {
    for (const bad of [null, 'x', 7, [], undefined])
      expect(faults(bad).length).toBeGreaterThan(0);
  });
});

describe('назва', () => {
  it('порожня — відмова, бо для прибирання є null', () => {
    expect(faults({ name: '   ' })[0]).toContain('надішли null');
  });

  it(`довша за ${MAX_NAME} — відмова`, () => {
    expect(faults({ name: 'x'.repeat(MAX_NAME) })).toEqual([]);
    expect(faults({ name: 'x'.repeat(MAX_NAME + 1) }).length).toBe(1);
  });

  it('🔴 кутові дужки — відмова: назва їде на сторінку і в JSON-LD', () => {
    expect(faults({ name: '<b>Alpenblick</b>' }).length).toBe(1);
  });

  it('null — це прибирання, і воно дозволене', () => {
    expect(faults({ name: null })).toEqual([]);
  });
});

describe('зручності', () => {
  it('🔴 перелік ключів той самий, що в tag-mapping', () => {
    expect(AMENITY_KEYS).toHaveLength(10);
    expect([...AMENITY_KEYS].sort()).toEqual(
      [
        'dogFriendly',
        'electricity',
        'greyWater',
        'laundry',
        'shower',
        'toilets',
        'water',
        'wheelchair',
        'wheelchairFull',
        'wifi',
      ].sort(),
    );
  });

  it('вигадана зручність — відмова', () => {
    expect(faults({ amenities: { jacuzzi: 'yes' } })[0]).toContain('не існує');
  });

  it('значення поза трьома — відмова', () => {
    expect(faults({ amenities: { shower: 'maybe' } })[0]).toContain(
      'yes, no, unknown',
    );
    expect(faults({ amenities: { shower: true } }).length).toBe(1);
  });

  it('🔴 unknown дозволено: «я не знаю» — чесна відповідь', () => {
    // Інакше єдиний спосіб зняти хибне «yes» — поставити «no», тобто
    // замінити одну неправду на іншу.
    expect(faults({ amenities: { shower: 'unknown' } })).toEqual([]);
  });
});

describe('накладання правки', () => {
  it('додає і замінює', () => {
    expect(merge({}, { name: 'A' })).toEqual({ name: 'A' });
    expect(merge({ name: 'A' }, { name: 'B' })).toEqual({ name: 'B' });
  });

  it('обрізає пробіли', () => {
    expect(merge({}, { name: '  A  ' })).toEqual({ name: 'A' });
  });

  it('зручності зливаються, а не затирають одна одну', () => {
    expect(
      merge({ amenities: { shower: 'yes' } }, { amenities: { wifi: 'no' } }),
    ).toEqual({ amenities: { shower: 'yes', wifi: 'no' } });
  });

  it('🔴 null ПРИБИРАЄ правку, а не записує порожнє', () => {
    // Власник, що помилився, мусить мати спосіб повернути те, що каже
    // OSM. Якби тут лишався `null`, він затулив би справжнє значення:
    // `withOwnerOverrides` зливає об'єкт поверх OSM як є.
    expect(merge({ name: 'A' }, { name: null })).toEqual({});
    const out = merge(
      { amenities: { shower: 'yes', wifi: 'no' } },
      {
        amenities: { shower: null },
      },
    );
    expect(out).toEqual({ amenities: { wifi: 'no' } });
    expect(JSON.stringify(out)).not.toContain('null');
  });

  it('остання прибрана зручність забирає й сам об’єкт', () => {
    expect(
      merge({ amenities: { shower: 'yes' } }, { amenities: { shower: null } }),
    ).toEqual({});
  });

  it('amenities: null прибирає всі зручності, лишаючи назву', () => {
    expect(
      merge({ name: 'A', amenities: { shower: 'yes' } }, { amenities: null }),
    ).toEqual({ name: 'A' });
  });

  it('🔴 не чіпає того, чого немає в правці', () => {
    const before = { name: 'A', amenities: { shower: 'yes' } };
    expect(merge(before, { amenities: { wifi: 'no' } })).toEqual({
      name: 'A',
      amenities: { shower: 'yes', wifi: 'no' },
    });
    // І не псує вхідний об'єкт.
    expect(before).toEqual({ name: 'A', amenities: { shower: 'yes' } });
  });

  it('WRITABLE — рівно три поля, і це саме ті, що зливає сторінка', () => {
    expect([...WRITABLE]).toEqual(['name', 'amenities', 'hookup']);
  });

  // 🔴 merge() БЕЗПЕЧНА САМА ПО СОБІ, А НЕ ЗА ДОМОВЛЕНІСТЮ З ВИКЛИКАЧЕМ.
  //
  // CodeQL знайшов тут `js/remote-property-injection`, двічі high: ім'я
  // властивості, у яку пишемо, походило з тіла запиту. Сьогодні перед
  // нею завжди стоїть `faults()` — але гарантія жила в ІНШІЙ функції, і
  // другий виклик без перевірки зняв би її мовчки.
  it('🔴 вигадані ключі не долітають навіть повз faults()', () => {
    expect(
      merge({}, { amenities: { jacuzzi: 'yes', shower: 'yes' } } as never),
    ).toEqual({ amenities: { shower: 'yes' } });
  });

  it('🔴 __proto__ і constructor не записуються й нічого не псують', () => {
    const out = merge({}, {
      amenities: { __proto__: 'yes', constructor: 'yes' },
    } as never);
    expect(out).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false);
    // І прототип самого Object лишився незайманим.
    expect(({} as Record<string, unknown>).jacuzzi).toBeUndefined();
  });

  it('успадковане від прототипу теж не рахується як правка', () => {
    const inherited = Object.create({ shower: 'yes' }) as Record<
      string,
      unknown
    >;
    expect(merge({}, { amenities: inherited } as never)).toEqual({});
  });
});

describe('CAMP-503: hookup (живлення кемпера на стоянці, не заряджання авто)', () => {
  it('приймає число в межах і зберігає його', () => {
    const patch = {
      hookup: { voltageV: 230, powerKw: 3.7, priceEurPerNight: 4.5 },
    };
    expect(faults(patch)).toEqual([]);
    expect(merge({}, patch).hookup).toEqual(patch.hookup);
  });
  it('відхиляє поза межами, не число, нецілу напругу й чуже поле', () => {
    expect(faults({ hookup: { voltageV: 12 } })).toHaveLength(1);
    expect(faults({ hookup: { voltageV: 230.5 } })).toHaveLength(1);
    expect(faults({ hookup: { powerKw: '3' } })).toHaveLength(1);
    expect(faults({ hookup: { priceEurPerNight: -1 } })).toHaveLength(1);
    expect(faults({ hookup: { chargerKw: 11 } })).toHaveLength(1);
  });
  it('null прибирає поле, а останнє прибране забирає весь обʼєкт', () => {
    const one = merge({}, { hookup: { voltageV: 230, powerKw: 3 } });
    expect(merge(one, { hookup: { voltageV: null } }).hookup).toEqual({
      powerKw: 3,
    });
    expect(merge(one, { hookup: null }).hookup).toBeUndefined();
  });
});
