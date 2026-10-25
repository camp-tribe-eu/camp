import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, type QueryRunner } from 'typeorm';
import { SeedLegalPages1792800000000 } from '../migrations/1792800000000-SeedLegalPages';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/**
 * 🔴 CAMP-365 — ЩО САМЕ ВИДНО ЧИТАЧЕВІ З ПРАВОВИХ ДОКУМЕНТІВ.
 *
 * Перевіряється ПО HTTP і на справжній базі, а не читанням SQL. Твердження
 * «чернетка назовні не виходить» про форму запиту лишилось би зеленим, якщо
 * предикат є, але стоїть не в тій дужці або порівнює не те поле. Тому рядки
 * саджаються у справжню таблицю, а відповідь читається з маршруту.
 *
 * 🔴 І В ТРАНЗАКЦІЇ, ЯКА ВІДКОЧУЄТЬСЯ — як у `pages.service.spec.ts`. Сервіс
 * отримує `queryRunner` замість `DataSource`: він користується лише
 * `.query`, а так усі запити йдуть тим самим зʼєднанням, що й посаджені
 * рядки, інакше транзакція сховала б їх від перевірки.
 *
 * 🔴 ДОКУМЕНТІВ, ЯКІ ЗАСІЯЛА МІГРАЦІЯ, ТУТ НЕ ЧІПАЄМО Й НЕ ПОРІВНЮЄМО З
 * ЧИМОСЬ ЗІ СВОГО УЯВЛЕННЯ: окремий випадок лише питає, що всі сім віддаються
 * з непорожнім тілом. Посимвольну рівність бази з міграцією тримає
 * `legal-seed.spec.ts`.
 */
describe('GET /legal: що видно читачеві', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      // Та сама конвенція, що в `pages.service.spec.ts`. Відсутня база —
      // це падіння, а не пропуск: пропущений тест виглядає так само
      // зелено, як пройдений.
      url:
        process.env.CAMP_TEST_DATABASE_URL ??
        process.env.CI_DATABASE_URL ??
        'postgres://localhost:5432/camptribe_dev',
    });
    await ds.initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const moduleRef = await Test.createTestingModule({
      controllers: [LegalController],
      providers: [
        LegalService,
        { provide: getDataSourceToken(), useValue: qr },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterEach(async () => {
    await app.close();
    await qr.rollbackTransaction();
    await qr.release();
  });

  /**
   * Документ у базі. `langs` — які переклади в нього є.
   *
   * Тіло містить те, що правовий текст справді несе й що легко зіпсувати
   * дорогою: підстановки, фігурні дужки якоря, нерозривний пробіл, лапки
   * й переклад рядка.
   */
  const BODY =
    '## 1. Тест {#t1}\n\nПідстановка {{company.name}}, «лапки», a b.\n';
  const add = async (
    slug: string,
    status: string,
    langs: string[] = ['en'],
    version = '9.9',
    effectiveFrom = '2026-10-16',
  ) => {
    const rows = (await qr.query(
      `INSERT INTO legal_pages (slug, version, effective_from, status)
       VALUES ($1, $2, $3, $4::legal_pages_status_enum) RETURNING id`,
      [slug, version, effectiveFrom, status],
    )) as Array<{ id: string }>;
    for (const lang of langs) {
      await qr.query(
        `INSERT INTO legal_page_translations
           (legal_page_id, language_code, title, plain_summary, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id, lang, `Назва ${slug}`, `Опис ${slug}`, BODY],
      );
    }
  };

  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`);
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  const slugsOf = async (path = '/legal') =>
    ((await get(path)).json.documents as Array<{ slug: string }>).map(
      (d) => d.slug,
    );

  it('опублікований документ — видно, з усіма полями, які друкує сторінка', async () => {
    await add('camp365-live', 'published');
    const { status, json } = await get('/legal/camp365-live');
    expect(status).toBe(200);
    expect(json).toEqual({
      slug: 'camp365-live',
      title: 'Назва camp365-live',
      summary: 'Опис camp365-live',
      version: '9.9',
      effectiveFrom: '2026-10-16',
      body: BODY,
    });
  });

  it('перелік несе ті самі поля, але БЕЗ тіла', async () => {
    await add('camp365-live', 'published');
    const docs = (await get('/legal')).json.documents as Array<
      Record<string, unknown>
    >;
    const mine = docs.find((d) => d.slug === 'camp365-live');
    // Пара: документ у переліку є, інакше «тіла немає» істинне над
    // порожнім переліком.
    expect(mine).toBeDefined();
    expect(mine).toEqual({
      slug: 'camp365-live',
      title: 'Назва camp365-live',
      summary: 'Опис camp365-live',
      version: '9.9',
      effectiveFrom: '2026-10-16',
    });
    expect(Object.keys(mine as object)).not.toContain('body');
  });

  // Порядок у переліку — за слагом, і це обіцянка, яку читає хтось інший:
  // збірка порівнює перелік із реєстром, а незмінний порядок робить її
  // повідомлення про розбіжність відтворюваним.
  it('перелік упорядковано за слагом, а не за порядком вставки', async () => {
    await add('camp365-b', 'published');
    await add('camp365-a', 'published');
    const mine = (await slugsOf()).filter((s) => s.startsWith('camp365-'));
    expect(mine).toEqual(['camp365-a', 'camp365-b']);
  });

  // 🔴 КОЖЕН НЕОПУБЛІКОВАНИЙ СТАН ОКРЕМО. Перевірка лише `draft` лишила б
  // живою мутацію `status <> 'draft'`: `review` (чекає на юриста) і
  // `archived` (знятий) вийшли б назовні.
  it.each(['draft', 'review', 'archived'])(
    '🔴 документ у стані %s назовні не виходить — ні в переліку, ні за слагом',
    async (state) => {
      await add('camp365-live', 'published');
      await add(`camp365-${state}`, state);

      const listed = await slugsOf();
      // Пара: опублікований поруч видно, тож перелік не порожній.
      expect(listed).toContain('camp365-live');
      expect(listed).not.toContain(`camp365-${state}`);

      const one = await get(`/legal/camp365-${state}`);
      expect(one.status).toBe(404);
    },
  );

  // 🔴 ПЕРЕКЛАД ІНШОЮ МОВОЮ — ЦЕ НЕ ПЕРЕКЛАД ТІЄЮ. Документ, що має лише
  // німецьку, для англійського читача відсутній, а не порожній.
  it('🔴 без перекладу запитаною мовою документа немає, а не він порожній', async () => {
    await add('camp365-live', 'published');
    await add('camp365-de-only', 'published', ['de']);

    expect(await slugsOf()).toContain('camp365-live');
    expect(await slugsOf()).not.toContain('camp365-de-only');
    expect((await get('/legal/camp365-de-only')).status).toBe(404);

    // І мова справді береться із запиту, а не зашита: німецькою той самий
    // документ є.
    expect(await slugsOf('/legal?language=de')).toContain('camp365-de-only');
    expect((await get('/legal/camp365-de-only?language=de')).status).toBe(200);
  });

  it('🔴 слаг, якого немає, — 404, а не порожній документ', async () => {
    const res = await get('/legal/camp365-nothing-here');
    expect(res.status).toBe(404);
    expect(res.json).not.toHaveProperty('body');
  });

  // 🔴 ДАТА НАБУТТЯ ЧИННОСТІ — КАЛЕНДАРНА, А НЕ МОМЕНТ. Колонка `date`; драйвер
  // віддає її як `Date` опівночі за ПОЯСОМ СЕСІЇ, а JSON робить із неї
  // `…T22:00:00Z` попереднього дня. Тому поясом сесії ставимо найдальший —
  // якщо в запиті лишилась сира колонка, рядок стане 15 жовтня.
  it('🔴 дата чинності лишається календарною при будь-якому поясі сесії', async () => {
    await qr.query(`SET LOCAL timezone = 'Pacific/Kiritimati'`);
    await add('camp365-live', 'published', ['en'], '9.9', '2026-10-16');
    const { json } = await get('/legal/camp365-live');
    expect(json.effectiveFrom).toBe('2026-10-16');
    expect(typeof json.effectiveFrom).toBe('string');

    // І в переліку теж: це другий запит зі своїм `to_char`, і мутація, що
    // зачепила лише його, інакше пройшла б повз.
    const listed = (await get('/legal')).json.documents as Array<{
      slug: string;
      effectiveFrom: unknown;
    }>;
    expect(listed.find((d) => d.slug === 'camp365-live')?.effectiveFrom).toBe(
      '2026-10-16',
    );
  });

  // 🔴 ЦЕ НЕ ПОРІВНЯННЯ З МІГРАЦІЄЮ СИМВОЛ У СИМВОЛ (його робить
  // `legal-seed.spec.ts`), а перевірка того, що для веб-збірки обовʼязкове:
  // усі документи, які засіяла міграція, віддаються з непорожнім тілом.
  it('усі документи, які засіяла міграція, віддаються з тілом', async () => {
    const seeded = (
      new SeedLegalPages1792800000000() as unknown as {
        pages: Array<{ slug: string; body: string }>;
      }
    ).pages;
    // Пара: міграція справді щось несе, інакше цикл нижче порожній.
    expect(seeded.length).toBeGreaterThan(0);

    const listed = await slugsOf();
    // Збираємо назви тих, що не віддались, а не падаємо на першому: звіт
    // «розійшовся privacy» кращий за «щось розійшлось».
    const broken: string[] = [];
    for (const p of seeded) {
      if (!listed.includes(p.slug)) {
        broken.push(`${p.slug}: немає в переліку`);
        continue;
      }
      const { status, json } = await get(`/legal/${p.slug}`);
      if (status !== 200) broken.push(`${p.slug}: статус ${status}`);
      else if (!(json.body?.length > 1000)) {
        broken.push(`${p.slug}: тіло ${json.body?.length ?? 'відсутнє'}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
