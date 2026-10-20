import { readOutline, toView } from './spots.service';
import { SPOT_DETAIL_SQL } from './detail-query';
import { isSecondarySql } from './links';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const code = SPOT_DETAIL_SQL.replace(/--[^\n]*/g, '').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  // 🔴 Дві форми, якими рецензія обійшла першу редакцію цього сторожа:
  // блоковий коментар `/* … */` (знімалась лише рискова форма) і
  // перейменування в `AS outline_wkt` (regex не мав межі після `outline`,
  // тож матчив префіксом). Обидві лишали 7 тестів зеленими, тоді як
  // `row.outline` ставав undefined на ВСІХ сторінках.
  it('віддається з колонки як GeoJSON, а не як сира геометрія', () => {
    // Сира колонка приїхала б як WKB-рядок і не була б GeoJSON узагалі.
    expect(code).toMatch(/ST_AsGeoJSON\(s\.outline\)\s+AS\s+outline\s*,/);
  });

  it('🔴 береться з s.outline, а не з s.location', () => {
    // Різниця не академічна: `ST_AsGeoJSON(s.location)` теж валідний
    // GeoJSON і теж намалювався б — крапкою, яку читач прочитав би як
    // «ділянка завбільшки нуль».
    expect(code).not.toMatch(/ST_AsGeoJSON\(s\.location\)\s+AS\s+outline\s*,/);
  });

  it('🔴 і це колонка саме `outline`, а не щось, що з неї починається', () => {
    // `AS outline_wkt` матчив би regex без межі — і `row.outline` був би
    // undefined скрізь.
    expect(code).not.toMatch(/AS\s+outline_/);
  });

  it('🔴 toView переносить контур у відповідь, а не губить по дорозі', () => {
    // Ланка `SQL → toView` була голою: рецензія довела мутацією
    // `outline: null`, що 13 тестів лишались зеленими, tsc код 0, а фіча
    // мертва на кожній сторінці. Проп, розібраний рядок і поле у
    // відповіді — це три різні питання.
    const raw =
      '{"type":"MultiPolygon","coordinates":[[[[14,46],[14,47],[15,47],[14,46]]]]}';
    const view = toView({
      slug: 's',
      name: null,
      country: 'SE',
      region: 'Dalarna',
      type: 'paid',
      lat: 46,
      lon: 14,
      outline: raw,
      amenities: {},
    });
    expect(view.outline?.type).toBe('MultiPolygon');
  });

  it('а коли колонка порожня — у відповіді саме null', () => {
    const view = toView({
      slug: 's',
      name: null,
      country: 'SE',
      region: 'Dalarna',
      type: 'paid',
      lat: 46,
      lon: 14,
      outline: null,
      amenities: {},
    });
    expect(view.outline).toBeNull();
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

// 🔴 Правило «який рядок бере обрис» тепер живе у ДВОХ місцях: у
// `isSecondarySql()` і дослівною копією в `ci-seed-page-outline.sql`.
// SQL-фікстура не може імпортувати TS-хелпер, тож дублювання тут —
// ціна, а не недбалість. Але дублювання без сторожа це розходження, яке
// чекає нагоди: наступна зміна хелпера лишила б фікстуру зі старим
// правилом, і e2e упав би з ХИБНОЮ назвою причини («гілка недосяжна»
// замість «рядок не в індексі»). Назвала рецензія PR #292.
describe('🔴 CAMP-352: фікстура обрису бере той самий рядок, що й індекс', () => {
  const fixture = readFileSync(
    join(__dirname, '../../test/fixtures/ci-seed-page-outline.sql'),
    'utf8',
  );
  const squash = (x: string) => x.replace(/\s+/g, ' ').trim();

  it('містить предикат isSecondarySql дослівно', () => {
    // `isSecondarySql` повертає `EXISTS (…)`; у фікстурі він стоїть під
    // `NOT`, тож звіряємо саме тіло.
    expect(squash(fixture)).toContain(squash(isSecondarySql('s')));
  });

  it('і стоїть саме під запереченням — інакше правило перевернуте', () => {
    expect(squash(fixture)).toContain('AND NOT ' + squash(isSecondarySql('s')));
  });
});
