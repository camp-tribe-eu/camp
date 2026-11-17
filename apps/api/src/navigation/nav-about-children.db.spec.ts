import { DataSource, type QueryRunner } from 'typeorm';
import { NavAboutChildren1797970000000 } from '../migrations/1797970000000-NavAboutChildren';

/**
 * CAMP-441 (13): the About dropdown. Checked on the real table, in a
 * transaction that is rolled back: order, labels, idempotency, and that
 * `down()` leaves Contact alone.
 */
describe('NavAboutChildren: the About dropdown', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  const m = new NavAboutChildren1797970000000();

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
    await m.down(qr);
  });
  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  const kids = async (): Promise<Array<{ href: string; label: string }>> =>
    qr.query(
      `SELECT n.href, t.label FROM navigation n
         JOIN navigation p ON p.id = n.parent_id
         LEFT JOIN navigation_translations t ON t.navigation_id = n.id AND t.language_code = 'en'
        WHERE p.location = 'header' AND p.href = '/about' AND p.parent_id IS NULL
        ORDER BY n.sort, t.label`,
    );

  it('after up(): About us, Contact, Legal notice, Data sources — in that order, each labelled', async () => {
    await m.up(qr);
    expect(await kids()).toEqual([
      { href: '/about', label: 'About us' },
      { href: '/contact', label: 'Contact' },
      { href: '/legal/notice', label: 'Legal notice' },
      { href: '/legal/attribution', label: 'Data sources' },
    ]);
  });

  it('🔴 a second up() adds nothing', async () => {
    await m.up(qr);
    await m.up(qr);
    expect((await kids()).length).toBe(4);
  });

  it('🔴 down() removes only its own rows: Contact stays', async () => {
    await m.up(qr);
    await m.down(qr);
    expect((await kids()).map((k) => k.href)).toEqual(['/contact']);
  });
});
