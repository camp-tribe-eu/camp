import { readOutline } from './spots.service';
import { SPOT_DETAIL_SQL } from './detail-query';

// CAMP-352, крок 4 — контур доходить до сторінки або не доходить узагалі.
//
// 🔴 ЧОМУ ЦЕ ОКРЕМИЙ ФАЙЛ. `ST_AsGeoJSON` віддає РЯДОК. Якщо його не
// розібрати, він поїде на сторінку як текст, `JSON.stringify` обгорне
// його в лапки, і мапа отримає рядок там, де чекає геометрію. Нічого не
// впаде: обрис просто не намалюється, а підпис під мапою й далі
// обіцятиме його читачеві. Саме цей клас дефекту — тихий — цей файл і
// ловить.

describe('🔴 CAMP-352: контур у відповіді API', () => {
  // 🔴 Statement БЕЗ `--` коментарів. Перша редакція матчила сирий текст,
  // і рецензія це зламала однією рискою: дописати `-- ` перед колонкою —
  // і сім тестів лишались зеленими, тоді як `row.outline` ставав
  // undefined на ВСІХ сторінках, а підпис далі обіцяв обрис. Сторож на
  // текст мусить читати код, а не прозу поруч.
  const code = SPOT_DETAIL_SQL.replace(/--[^\n]*/g, '');

  it('віддається з колонки як GeoJSON, а не як сира геометрія', () => {
    // Сира колонка приїхала б як WKB-рядок і не була б GeoJSON узагалі.
    expect(code).toMatch(/ST_AsGeoJSON\(s\.outline\)\s+AS\s+outline/);
  });

  it('🔴 береться з s.outline, а не з s.location', () => {
    // Різниця не академічна: `ST_AsGeoJSON(s.location)` теж валідний
    // GeoJSON і теж намалювався б — крапкою, яку читач прочитав би як
    // «ділянка завбільшки нуль».
    expect(code).not.toMatch(/ST_AsGeoJSON\(s\.location\)\s+AS\s+outline/);
  });

  it('розбирає MultiPolygon у обʼєкт', () => {
    const raw =
      '{"type":"MultiPolygon","coordinates":[[[[14,46],[14,47],[15,47],[14,46]]]]}';
    const got = readOutline(raw);
    expect(got?.type).toBe('MultiPolygon');
    expect(Array.isArray(got?.coordinates)).toBe(true);
  });

  it('розбирає і Polygon — колонка оголошена Multi, але читаємо обидва', () => {
    const raw =
      '{"type":"Polygon","coordinates":[[[14,46],[14,47],[15,47],[14,46]]]}';
    expect(readOutline(raw)?.type).toBe('Polygon');
  });

  it('🔴 NULL із бази стає null, а не рядком «null»', () => {
    // `pg` віддає SQL NULL як JS null. Рядок «null» тут означав би, що
    // десь по дорозі значення пройшло через конкатенацію.
    expect(readOutline(null)).toBeNull();
    expect(readOutline(undefined)).toBeNull();
    expect(readOutline('')).toBeNull();
  });

  it('🔴 зіпсоване значення НЕ малюється, а не малюється абияк', () => {
    // Краще не показати обрис, ніж показати зламаний: сторінка кемпінгу
    // тим і торгує, що нічого не вигадує.
    expect(readOutline('не json')).toBeNull();
    expect(readOutline('{"type":"MultiPolygon"}')).toBeNull();
    expect(readOutline('{"coordinates":[]}')).toBeNull();
    expect(readOutline('[1,2,3]')).toBeNull();
    expect(readOutline('42')).toBeNull();
  });

  it('уже розібраний обʼєкт не приймається — очікуємо саме рядок', () => {
    // Якби `pg` колись почав віддавати обʼєкт, мовчазне прийняття
    // сховало б зміну поведінки драйвера. Нехай краще обрис зникне й
    // це стане помітно.
    expect(readOutline({ type: 'MultiPolygon', coordinates: [] })).toBeNull();
  });
});
