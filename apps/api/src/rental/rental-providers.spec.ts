import {
  DEFAULT_SORT,
  normaliseCountry,
  normaliseServices,
  sortClause,
  SORTS,
} from './rental-providers.service';

// CAMP-427: що саме відмовляє запит каталогу, і чому мовчазна поблажливість
// тут гірша за помилку.

describe('сортування каталогу', () => {
  it('без ключа — сортування за замовчуванням', () => {
    expect(sortClause(undefined)).toBe(SORTS[DEFAULT_SORT]);
  });

  it.each(Object.keys(SORTS))('ключ «%s» дає свій вираз', (key) => {
    expect(sortClause(key)).toBe(SORTS[key]);
  });

  // 🔴 Мовчазне падіння на сортування за замовчуванням виглядає для читача
  // як «сортування не працює», а для нас — як зелений тест: сторінка ж
  // віддалась. Тому невідомий ключ мусить КАЗАТИ про себе.
  it('🔴 невідомий ключ — помилка, що називає доступні', () => {
    expect(() => sortClause('popularity')).toThrow(/невідоме сортування/);
    expect(() => sortClause('popularity')).toThrow(/name/);
  });

  // 🔴 Ключ із запиту НІКОЛИ не потрапляє в SQL — у запит іде значення з
  // мапи. Без цього випадку «сортування працює» лишалось би зеленим і з
  // діркою для ін'єкції.
  it('🔴 спроба підставити SQL відмовляється, а не підставляється', () => {
    expect(() => sortClause('name; DROP TABLE rental_providers')).toThrow(
      /невідоме сортування/,
    );
  });

  it('жоден вираз сортування не зібраний із вводу — усі літерали мапи', () => {
    for (const expr of Object.values(SORTS)) {
      expect(expr).toMatch(/^p\.[a-z_]+ (ASC|DESC)/);
    }
  });
});

describe('країна', () => {
  it('порожнє — це «без фільтра», а не помилка', () => {
    expect(normaliseCountry(undefined)).toBeUndefined();
    expect(normaliseCountry('')).toBeUndefined();
  });

  it('приводиться до верхнього регістру', () => {
    expect(normaliseCountry('de')).toBe('DE');
  });

  it('🔴 не код країни — відмова: інакше фільтр мовчки поверне порожньо', () => {
    for (const bad of ['DEU', 'D', '12', 'DE;--']) {
      expect(() => normaliseCountry(bad)).toThrow(/ISO-3166-1/);
    }
  });
});

describe('сервіси', () => {
  it('рядок через кому і масив читаються однаково', () => {
    expect(normaliseServices('one_way,pets_allowed')).toEqual([
      'one_way',
      'pets_allowed',
    ]);
    expect(normaliseServices(['one_way', 'pets_allowed'])).toEqual([
      'one_way',
      'pets_allowed',
    ]);
  });

  it('порожні елементи відкидаються, а не стають порожнім кодом', () => {
    expect(normaliseServices('one_way,,  ,bedding')).toEqual([
      'one_way',
      'bedding',
    ]);
  });

  it('🔴 код не з того словника — відмова з переліком винних', () => {
    expect(() => normaliseServices('one_way,Pets Allowed')).toThrow(
      /Pets Allowed/,
    );
  });
});
