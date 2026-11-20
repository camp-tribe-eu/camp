import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryRunner } from 'typeorm';
import { PrivacyOwnerVerifyLink1797810000000 } from '../migrations/1797810000000-PrivacyOwnerVerifyLink';
import { PrivacyTripStorage1797850000000 } from '../migrations/1797850000000-PrivacyTripStorage';
import { PrivacyContactForm1797950000000 } from '../migrations/1797950000000-PrivacyContactForm';
import { PrivacyNewsletter1798050000000 } from '../migrations/1798050000000-PrivacyNewsletter';
import { seededLegalPages } from './legal-seeded';

// CAMP-456 поверх CAMP-505: дві міграції правили політику приватності
// паралельно, обидві спершу брали 2.9. Це тримає ланцюг: 3.0 будується з
// тексту 2.9, нічого з CAMP-505 не губить, а down() повертає саме 2.9.

const owner = new PrivacyOwnerVerifyLink1797810000000();
const trip = new PrivacyTripStorage1797850000000();
const contact = new PrivacyContactForm1797950000000();
const newsletter = new PrivacyNewsletter1798050000000();

/** Мінімальна «база»: один рядок політики, запити — ті, що шле legal-update. */
function fakeDb(start: { version: string; body: string }) {
  const row = {
    id: 'p1',
    version: start.version,
    effective_from: '',
    body: start.body,
  };
  const runner = {
    query: (sql: string, params: unknown[] = []): Promise<unknown> => {
      if (sql.includes('SELECT lp.id, lp.version, t.body')) {
        return Promise.resolve([
          { id: row.id, version: row.version, body: row.body },
        ]);
      }
      if (sql.includes('SELECT lp.id')) {
        return Promise.resolve(params[1] === row.body ? [{ id: row.id }] : []);
      }
      if (sql.includes('UPDATE legal_page_translations')) {
        row.body = params[3] as string;
        return Promise.resolve([]);
      }
      if (sql.includes('UPDATE legal_pages')) {
        row.version = params[1] as string;
        row.effective_from = params[2] as string;
        return Promise.resolve([]);
      }
      throw new Error(`непередбачений запит: ${sql}`);
    },
  };
  return { row, runner: runner as unknown as QueryRunner };
}

describe('політика приватності: 3.0 поверх 2.9', () => {
  it('3.0 будується з тексту 2.9 (CAMP-505), а не зі старішого', () => {
    expect(trip.previous.body).toBe(owner.page.body);
    expect(trip.previous.version).toBe('2.9');
    expect(trip.page.version).toBe('3.0');
    expect(trip.page.effectiveFrom).toBe('2026-11-15');
  });

  it('🔴 після обох міграцій текст має і розділ CAMP-505, і розділ CAMP-456', () => {
    const body = trip.page.body;
    // CAMP-505
    expect(body).toContain('There are two ways to prove it is yours');
    expect(body).toContain('at least **30 days**');
    expect(body).toContain('so Article 6(1)(b) cannot be the basis for them');
    // CAMP-456
    expect(body).toContain('writes six entries into your browser’s storage');
    expect(body).toContain('camptribe.trips');
    expect(body).toContain('`/plan?to=…`');
    // і жодна з них не витіснила іншу
    expect(body).not.toContain('writes five entries');
  });

  it('🔴 те саме — у тексті, який віддає сид-реєстр (його читають сторожі сторінки)', () => {
    const privacy = seededLegalPages().find((p) => p.slug === 'privacy');
    expect(privacy?.version).toBe('3.2');
    expect(privacy?.body).toContain('There are two ways to prove it is yours');
    expect(privacy?.body).toContain('camptribe.trips');
  });

  it('up() з бази 2.9 дає 3.0, down() повертає 2.9 з CAMP-505, а не старіше', async () => {
    const db = fakeDb({ version: '2.9', body: owner.page.body });
    await trip.up(db.runner);
    expect(db.row.version).toBe('3.0');
    expect(db.row.body).toBe(trip.page.body);

    await trip.down(db.runner);
    expect(db.row.version).toBe('2.9');
    expect(db.row.body).toBe(owner.page.body);
    expect(db.row.body).toContain('There are two ways to prove it is yours');
  });

  it('база зі старим 2.8 не приймається мовчки (порядок міграцій має значення)', async () => {
    const db = fakeDb({ version: '2.8', body: owner.previous.body });
    await expect(trip.up(db.runner)).rejects.toThrow(/не знає/);
  });

  it('🔴 версія й дата в legal.ts і legal-review.json — ті самі, що в міграції', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    const ts = readFileSync(join(root, 'apps/web/src/lib/legal.ts'), 'utf8');
    const m =
      /slug: 'privacy',[\s\S]*?version: '([\d.]+)',\s*effectiveFrom: '([\d-]+)'/.exec(
        ts,
      );
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe(newsletter.page.version);
    expect(m?.[2]).toBe(newsletter.page.effectiveFrom);
    const review = JSON.parse(
      readFileSync(join(root, 'scripts/seo/legal-review.json'), 'utf8'),
    ) as { pages: Record<string, string>; note: string };
    expect(review.pages.privacy).toBe(newsletter.page.version);
    // у журналі читання названо обидві зміни: 2.9 (CAMP-505) і 3.0 (CAMP-456)
    expect(review.note).toContain('PRIVACY 2.8 → 2.9');
    expect(review.note).toContain('CAMP-505');
    expect(review.note).toContain('PRIVACY 2.9 → 3.0');
    expect(review.note).toContain('CAMP-456');
    // і 3.1 (CAMP-441), чернетка, що чекає погодження власника
    expect(review.note).toContain('PRIVACY 3.0 → 3.1');
    expect(review.note).toContain('NOT YET APPROVED BY THE OWNER');
    // і 3.2 (CAMP-441/7), теж чернетка
    expect(review.note).toContain('PRIVACY 3.1 → 3.2');
  });

  it('🔴 відбиток тексту 3.2 НЕ вписано: його ставлять після викладки, а до того сторож лише попереджає', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    const review = JSON.parse(
      readFileSync(join(root, 'scripts/seo/legal-review.json'), 'utf8'),
    ) as { texts: Record<string, string> };
    expect(review.texts.privacy).toBeUndefined();
  });
});

describe('політика приватності: 3.1 поверх 3.0 (форма «Write to us», CAMP-441)', () => {
  it('3.1 будується з тексту 3.0 і нічого з нього не губить', () => {
    expect(contact.previous.body).toBe(trip.page.body);
    expect(contact.previous.version).toBe('3.0');
    expect(contact.page.version).toBe('3.1');
    expect(contact.page.body).toContain('camptribe.trips');
    expect(contact.page.body).toContain(
      'There are two ways to prove it is yours',
    );
  });

  it('розділ «Writing to us» має якір і розповідає про форму', () => {
    const body = contact.page.body;
    expect(body).toContain('### Writing to us {#writing}');
    expect(body).toContain('the form on the [contact page](/contact)');
    expect(body).toContain('they are not written to our database');
    expect(body).toContain('{{company.email}}');
  });

  it('up() з бази 3.0 дає 3.1, down() повертає 3.0', async () => {
    const db = fakeDb({ version: '3.0', body: trip.page.body });
    await contact.up(db.runner);
    expect(db.row.version).toBe('3.1');
    expect(db.row.body).toBe(contact.page.body);
    await contact.down(db.runner);
    expect(db.row.version).toBe('3.0');
    expect(db.row.body).toBe(trip.page.body);
  });

  it('база зі старим 2.9 не приймається мовчки', async () => {
    const db = fakeDb({ version: '2.9', body: owner.page.body });
    await expect(contact.up(db.runner)).rejects.toThrow(/не знає/);
  });
});

describe('політика приватності: 3.2 поверх 3.1 (підписка на листи, CAMP-441/7)', () => {
  it('3.2 будується з тексту 3.1 і нічого з нього не губить', () => {
    expect(newsletter.previous.body).toBe(contact.page.body);
    expect(newsletter.previous.version).toBe('3.1');
    expect(newsletter.page.version).toBe('3.2');
    expect(newsletter.page.body).toContain('### Writing to us {#writing}');
    expect(newsletter.page.body).toContain('camptribe.trips');
  });

  it('розділ про листи має якір, а «How long we keep it» — свій рядок', () => {
    const body = newsletter.page.body;
    expect(body).toContain(
      '### Our letters, if you ask for them {#newsletter}',
    );
    expect(body).toContain('- **Addresses for our letters:**');
  });

  it('up() з бази 3.1 дає 3.2, down() повертає 3.1', async () => {
    const db = fakeDb({ version: '3.1', body: contact.page.body });
    await newsletter.up(db.runner);
    expect(db.row.version).toBe('3.2');
    expect(db.row.body).toBe(newsletter.page.body);
    await newsletter.down(db.runner);
    expect(db.row.version).toBe('3.1');
    expect(db.row.body).toBe(contact.page.body);
  });

  it('база зі старим 3.0 не приймається мовчки', async () => {
    const db = fakeDb({ version: '3.0', body: trip.page.body });
    await expect(newsletter.up(db.runner)).rejects.toThrow(/не знає/);
  });
});
