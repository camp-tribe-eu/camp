import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIMITS,
  PROBLEM_KINDS,
  REPORT_STATUSES,
  parseReport,
} from './problem-reports.rules';

// «Report a problem» — the rules, checked without a database.
//
// 🔴 Every case here is one a well-behaved page never sends and an attacker
// (or a later, careless client) will. The two the card names by mutation:
//   · remove the kind check  → "an unknown kind is refused" goes red;
//   · make contact required  → "no contact is accepted" goes red.
// `problem-reports.db.spec.ts` repeats both against the real table, because a
// rule that passes here and a column that refuses there would still lose the
// report.

const GOOD = {
  slug: 'camping-du-lac',
  kind: 'closed',
  description: 'Closed since 2024; the gate is chained and the sign is gone.',
};

const okOf = (body: unknown) => {
  const r = parseReport(body);
  expect(r.ok).toBe(true);
  if (r.ok === false) throw new Error('unreachable');
  return r.report;
};

const problemsOf = (body: unknown) => {
  const r = parseReport(body);
  expect(r.ok).toBe(false);
  if (r.ok === true) throw new Error('unreachable');
  return r.problems;
};

describe('a report without a contact is accepted — the normal case', () => {
  it('with no contact field at all', () => {
    expect(okOf(GOOD).contact).toBeNull();
  });

  it.each([null, '', '   '])('with contact %p', (contact) => {
    expect(okOf({ ...GOOD, contact }).contact).toBeNull();
  });

  it('and nothing else is invented: four fields come out, trimmed', () => {
    expect(okOf({ ...GOOD, description: `  ${GOOD.description}  ` })).toEqual({
      slug: 'camping-du-lac',
      kind: 'closed',
      description: GOOD.description,
      contact: null,
    });
  });
});

describe('a report with a contact is accepted too', () => {
  it('keeps the contact as typed, trimmed', () => {
    expect(okOf({ ...GOOD, contact: '  owner@example.com ' }).contact).toBe(
      'owner@example.com',
    );
  });

  it('a phone number is a contact as much as an address — we do not parse it', () => {
    expect(okOf({ ...GOOD, contact: '+385 91 000 0000' }).contact).toBe(
      '+385 91 000 0000',
    );
  });

  it('refuses a contact that is not text, rather than storing its JSON', () => {
    expect(problemsOf({ ...GOOD, contact: { email: 'x' } })).toEqual([
      expect.objectContaining({ field: 'contact', code: 'not_text' }),
    ]);
  });

  it('refuses a contact over the limit', () => {
    const c = 'x'.repeat(LIMITS.contact + 1);
    expect(problemsOf({ ...GOOD, contact: c })).toEqual([
      expect.objectContaining({ field: 'contact', code: 'too_long' }),
    ]);
    expect(
      okOf({ ...GOOD, contact: 'x'.repeat(LIMITS.contact) }).contact,
    ).toHaveLength(LIMITS.contact);
  });
});

describe('🔴 the kind must be one we offer', () => {
  it.each([...PROBLEM_KINDS])('%s is accepted', (kind) => {
    expect(okOf({ ...GOOD, kind }).kind).toBe(kind);
  });

  it.each(['spam', 'CLOSED', 'closed_', '', 7, null, ['closed']])(
    'an unknown kind %p is refused',
    (kind) => {
      const problems = problemsOf({ ...GOOD, kind });
      expect(problems.map((p) => p.field)).toEqual(['kind']);
    },
  );

  // `text()` trims before comparing, so surrounding whitespace is not a
  // different kind — pinned, so the list above is not read as saying otherwise.
  it('a kind with surrounding whitespace is the kind, trimmed', () => {
    expect(okOf({ ...GOOD, kind: ' closed ' }).kind).toBe('closed');
  });

  it('the list is the seven the migration allows, in the same spelling', () => {
    const migration = readFileSync(
      join(__dirname, '..', 'migrations', '1793300000000-ProblemReports.ts'),
      'utf8',
    );
    const check =
      /CONSTRAINT problem_reports_kind CHECK \(kind IN \(([\s\S]*?)\)\)/.exec(
        migration,
      );
    expect(check).not.toBeNull();
    const inTable = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...inTable].sort()).toEqual([...PROBLEM_KINDS].sort());
    expect(PROBLEM_KINDS.length).toBe(7);

    const status =
      /CONSTRAINT problem_reports_status CHECK \(status IN \(([\s\S]*?)\)\)/.exec(
        migration,
      );
    expect(status).not.toBeNull();
    const statuses = [...status![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...statuses].sort()).toEqual([...REPORT_STATUSES].sort());
  });

  it('and the limits are the ones the table enforces', () => {
    const migration = readFileSync(
      join(__dirname, '..', 'migrations', '1793300000000-ProblemReports.ts'),
      'utf8',
    );
    expect(migration).toContain(
      `CHECK (char_length(description) BETWEEN 1 AND ${LIMITS.description})`,
    );
    expect(migration).toContain(
      `CHECK (contact IS NULL OR char_length(contact) <= ${LIMITS.contact})`,
    );
  });
});

describe('the description', () => {
  it('is required, and whitespace is not a description', () => {
    for (const description of ['', '   ', undefined, 42]) {
      expect(problemsOf({ ...GOOD, description }).map((p) => p.field)).toEqual([
        'description',
      ]);
    }
  });

  it('is refused one character over the limit, and kept at the limit', () => {
    const atLimit = 'x'.repeat(LIMITS.description);
    expect(okOf({ ...GOOD, description: atLimit }).description).toHaveLength(
      LIMITS.description,
    );
    const over = 'x'.repeat(LIMITS.description + 1);
    expect(problemsOf({ ...GOOD, description: over })).toEqual([
      expect.objectContaining({
        field: 'description',
        code: 'too_long',
        message: expect.stringContaining(String(LIMITS.description + 1)),
      }),
    ]);
  });

  it('is rejected, not cut: a reader’s words are not truncated', () => {
    const r = parseReport({
      ...GOOD,
      description: 'y'.repeat(LIMITS.description + 500),
    });
    expect(r.ok).toBe(false);
  });
});

describe('the slug', () => {
  it('is required', () => {
    expect(problemsOf({ ...GOOD, slug: undefined }).map((p) => p.code)).toEqual(
      ['missing'],
    );
  });

  it.each(['../etc', 'Camping-Du-Lac', 'a b', 'x'.repeat(LIMITS.slug + 1)])(
    '%p is not the shape of a slug on this site and is refused here, before the database',
    (slug) => {
      expect(problemsOf({ ...GOOD, slug }).map((p) => p.field)).toEqual([
        'slug',
      ]);
    },
  );
});

describe('🔴 nothing but the four fields', () => {
  // The web side sends slug, kind, description and (sometimes) contact. A
  // client that starts sending a browser string or a page URL "for context"
  // must meet a refusal, not a table that quietly grew a column's worth of
  // data in a text field.
  it.each(['userAgent', 'ip', 'url', 'email', 'page'])(
    'a body carrying %s is refused and names the field',
    (extra) => {
      const problems = problemsOf({ ...GOOD, [extra]: 'anything' });
      expect(problems).toEqual([
        expect.objectContaining({
          field: 'body',
          code: 'unknown_field',
          message: expect.stringContaining(`"${extra}"`),
        }),
      ]);
    },
  );

  it.each([null, 'a string', 42, ['slug'], undefined])(
    'a body that is %p is not a report',
    (body) => {
      expect(problemsOf(body).map((p) => p.code)).toEqual(['not_an_object']);
    },
  );

  it('reports every problem at once, not the first', () => {
    const problems = problemsOf({
      slug: '',
      kind: 'nonsense',
      description: '',
      contact: 'x'.repeat(LIMITS.contact + 1),
      extra: 1,
    });
    expect(problems.map((p) => `${p.field}:${p.code}`).sort()).toEqual([
      'body:unknown_field',
      'contact:too_long',
      'description:missing',
      'kind:unknown',
      'slug:missing',
    ]);
  });
});
