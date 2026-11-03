import { AppDataSource } from './data-source';
import { PG_CONNECTION, PG_EXTRA, PG_SESSION_OPTIONS } from './db-session';

// CAMP-433: пояс сесії мусять нести САМІ ПУЛИ, а не лише константа.
//
// 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ, І ЦЕ ЗАМІР, А НЕ ОБЕРЕЖНІСТЬ.
//
// «Спосіб перевірки» в картці вимагав дослівно: прибрати
// `extra: PG_EXTRA` з `data-source.ts` — спек має почервоніти; прибрати
// з `app.module.ts` — теж; два місця, дві мутації, два червоних.
//
// Заміряно 03.11.2026 на свіжій базі: ОБИДВІ мутації вижили,
// `db-session.db.spec.ts` лишився зеленим 3 passed. Він відкриває
// власний `Client` із `options: PG_SESSION_OPTIONS` і до справжніх
// пулів не торкається — тобто доводив, що константа працює, а не що
// її хтось вживає. Інваріант був не під наглядом у ДВОХ місцях одразу.
//
// Тут перевірка чіпляється за СПРАВЖНІЙ обʼєкт `AppDataSource.options`,
// а не за текст файла: перейменування чи переформатування її не
// обдурить, а прибирання — зламає.
describe('🔴 пули справді несуть пояс сесії', () => {
  it('AppDataSource бере налаштування з PG_CONNECTION', () => {
    const extra = AppDataSource.options.extra as { options?: string };
    expect(extra).toBeDefined();
    expect(extra.options).toBe(PG_SESSION_OPTIONS);
  });

  it('🔴 і це той самий обʼєкт, а не схожий на нього', () => {
    expect(AppDataSource.options.extra).toBe(PG_EXTRA);
  });

  it('адреса теж одна на два пули', () => {
    expect((AppDataSource.options as { url?: string }).url).toBe(
      PG_CONNECTION.url,
    );
  });

  // 🔴 Перелік один рівно тому, що два не звіряються. Якщо колись
  // `app.module.ts` перестане розкладати `PG_CONNECTION`, зламається
  // саме це: іншого місця, де брати `extra`, в нього немає.
  it('🔴 PG_CONNECTION несе пояс, інакше його нікому нести', () => {
    expect(PG_CONNECTION.extra).toBe(PG_EXTRA);
    expect(PG_SESSION_OPTIONS).toContain('timezone=UTC');
  });
});
