import { DataSource, type QueryRunner } from 'typeorm';
import { HeaderFooterMenus1797480000000 } from '../migrations/1797480000000-HeaderFooterMenus';

/**
 * CAMP-448 — міграція меню читається з бази, а не з тексту запиту.
 *
 * 🔴 ПЕРЕВІРЯЄТЬСЯ НА СПРАВЖНІЙ ТАБЛИЦІ, у транзакції, яку відкочено. Тест,
 * що шукав би рядки `INSERT` у вихідному коді, лишився б зеленим і тоді, коли
 * умова `parent_id IS NOT DISTINCT FROM` перестала знаходити існуючий
 * рядок і міграція почала плодити дублі при повторі.
 *
 * Три речі, які тут стереже:
 *   • `up()` дає рівно те, що обіцяє: Contact під About у шапці, три колонки
 *     в підвалі з дітьми, і Contact у підвалі ПЕРЕЇХАВ, а не продубльований;
 *   • повторний `up()` не додає нічого (ідемпотентність: дубль пункту меню
 *     читач побачив би одразу);
 *   • `down()` повертає стан, який лишила `ContactInFooter`: Contact — корінь
 *     підвалу, колонок нема.
 */
describe('HeaderFooterMenus: що міграція кладе в меню й що забирає', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  const m = new HeaderFooterMenus1797480000000();

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
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
    // Починаємо з доміграційного стану, хоч база вже могла її накотити.
    await m.down(qr);
  });

  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  interface Row {
    location: string;
    href: string;
    parent_href: string | null;
  }
  const rows = async (): Promise<Row[]> =>
    qr.query(
      `SELECT n.location::text AS location, n.href, p.href AS parent_href
         FROM navigation n LEFT JOIN navigation p ON p.id = n.parent_id
        ORDER BY n.location, n.sort, n.href`,
    );
  const key = (r: Row) => `${r.location}:${r.parent_href ?? '-'}>${r.href}`;

  it('🔴 після down() — тільки те, що було до: Contact корінь підвалу, колонок нема', async () => {
    const got = (await rows()).filter((r) => r.location === 'footer').map(key);
    expect(got).toEqual(['footer:->/contact']);
    const aboutKids = (await rows()).filter(
      (r) => r.location === 'header' && r.parent_href === '/about',
    );
    expect(aboutKids).toEqual([]);
  });

  it('після up(): Contact під About, три колонки підвалу, Contact переїхав без дубля', async () => {
    await m.up(qr);
    const all = await rows();
    expect(
      all.filter((r) => r.location === 'header' && r.parent_href === '/about').map((r) => r.href),
    ).toEqual(['/contact']);

    const footer = all.filter((r) => r.location === 'footer');
    expect(footer.filter((r) => r.parent_href === null).map((r) => r.href)).toEqual([
      '/camping',
      '/plan',
      '/about',
    ]);
    expect(footer.filter((r) => r.parent_href === '/camping').map((r) => r.href)).toEqual([
      '/map',
      '/search',
      '/routes',
      '/guides',
    ]);
    expect(footer.filter((r) => r.parent_href === '/plan').map((r) => r.href)).toEqual([
      '/tools',
      '/tools/camper-trip-cost',
      '/tools/camper-packing-list',
      '/camper-rental',
      '/camper-rental/providers',
    ]);
    // Contact у підвалі один, і він тепер під CampTribe (/about).
    expect(footer.filter((r) => r.href === '/contact').map(key)).toEqual([
      'footer:/about>/contact',
    ]);
  });

  it('🔴 повторний up() нічого не додає', async () => {
    await m.up(qr);
    const once = (await rows()).map(key).sort();
    await m.up(qr);
    const twice = (await rows()).map(key).sort();
    expect(twice).toEqual(once);
  });

  it('кожен доданий пункт має англійський підпис, а без підпису API його не віддасть', async () => {
    await m.up(qr);
    const bare = await qr.query(
      `SELECT n.href FROM navigation n
        WHERE n.location = 'footer'
          AND NOT EXISTS (SELECT 1 FROM navigation_translations t
                           WHERE t.navigation_id = n.id AND t.language_code = 'en' AND t.label <> '')`,
    );
    expect(bare).toEqual([]);
  });
});
