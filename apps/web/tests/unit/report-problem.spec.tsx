import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import CampsitePage from '@/app/camping/[country]/[region]/[slug]/page';
import {
  CONTACT_HINT,
  KIND_LABEL,
  MAX_CONTACT,
  MAX_DESCRIPTION,
  PROBLEM_KINDS,
  interpret,
  messageFor,
  requestBody,
  sendReport,
  validateDraft,
  type ReportBody,
} from '@/lib/problem-report';
import { CLIENT_ISLANDS } from './client-islands';
import { requestReaders, walkImportGraph } from './import-graph';
import { renderAsyncComponent } from './render-component';
import { visibleText } from './rendered-text';

// «Report a problem» — what the campsite page shows, what it sends, and that
// it stays a static page while doing so.
//
// 🔴 EVERY CLAIM ABOUT THE PAGE READS THE HTML THE PAGE RENDERS — the real
// `CampsitePage` with `fetch` swapped for a canned API — through the same
// `visibleText` the other page specs use. Not a constant, not a class name,
// not a `data-testid`. The attribute checks below read the served tags.

type Fetcher = (url: string) => Response | Promise<Response>;

async function withFetch(impl: Fetcher, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// A campsite as the API returns it. Only what the page reads.
const SPOT = {
  slug: 'camping-report-test',
  name: 'Camping Report Test',
  country: 'hr',
  region: 'Istria',
  type: 'paid',
  lat: 45.1,
  lon: 13.9,
  amenities: {
    electricity: 'yes',
    water: 'unknown',
    shower: 'unknown',
    toilets: 'unknown',
    dogFriendly: 'unknown',
    wifi: 'unknown',
    greyWater: 'unknown',
    laundry: 'unknown',
    wheelchair: 'unknown',
    wheelchairFull: 'unknown',
  },
  ownerOverrides: {},
  lastSeenAt: '2026-10-12T05:00:00.000Z',
  osmRecordEditedAt: '2023-06-14T10:11:12.000Z',
  missingSince: null,
  context: {},
  description: null,
  descriptionLang: null,
  stars: null,
  website: null,
  contact: {},
  sources: [{ id: 'osm', ref: 'w1', updatedAt: '2026-10-12', fields: ['name', 'location'] }],
  warningAreas: null,
  tariffs: [],
  overnight: { status: 'unknown', source: null, checkedAt: null },
};

const PARAMS = { country: 'hr', region: 'istria', slug: 'camping-report-test' };

async function pageHtml(): Promise<string> {
  let html = '';
  await withFetch(
    (url) =>
      url.includes('/spots/hr/istria/camping-report-test')
        ? json({ spot: SPOT, nearby: [] })
        : json({}, 404),
    async () => {
      html = await renderAsyncComponent(
        CampsitePage,
        { params: Promise.resolve(PARAMS) },
        { omit: CLIENT_ISLANDS },
      );
    },
  );
  return html;
}

test.describe('the campsite page carries the form', () => {
  test('anchor: the page renders this campsite', async () => {
    const text = visibleText(await pageHtml());
    expect(text).toContain('Camping Report Test');
    expect(text.length).toBeGreaterThan(300);
  });

  test('🔴 says "Report a problem", and the words the card asks for beside the contact field', async () => {
    const text = visibleText(await pageHtml());
    expect(text).toContain('Report a problem');
    expect(text).toContain(CONTACT_HINT);
    expect(CONTACT_HINT).toBe(
      'Only so we can ask a follow-up question; leave it empty if you prefer.',
    );
    expect(text).toContain('(optional)');
    expect(text).toContain('Send report');
    // Before hydration the form says it is not live yet, as /plan does.
    expect(text).toContain('The form comes alive when the page finishes loading.');
  });

  // 🔴 Політика приватності 2.1 стверджує: «the form says the same beside
  // the field». Це твердження про сторінку, тож воно читається З ВІДДАНОЇ
  // сторінки — видимий текст, і що підказка привʼязана до поля опису через
  // aria-describedby, а не стоїть десь поруч.
  test('🔴 warns beside the description not to put personal details in — yours or anyone else’s', async () => {
    const html = await pageHtml();
    const text = visibleText(html);
    expect(text).toContain(
      'Please do not put personal details here — yours or anyone else’s: no names, phone numbers or addresses.',
    );
    expect(text).toContain('We do not filter what you write.');
    expect(text).toContain('How reports are handled is in the privacy policy.');

    const textarea = /<textarea\b[^>]*>/.exec(html)![0];
    const described = /aria-describedby="([^"]+)"/.exec(textarea)?.[1];
    expect(described, 'the textarea names no hint').toBeTruthy();
    const hint = new RegExp(`<p\\b[^>]*\\bid="${described}"[^>]*>([\\s\\S]*?)</p>`).exec(html);
    expect(hint, 'the hint the textarea points at is not on the page').not.toBeNull();
    expect(visibleText(hint![0])).toContain('Please do not put personal details here');
    // The link goes to the section of the policy that describes reports.
    expect(hint![0]).toContain('href="/legal/privacy#reports"');
  });

  test('offers every kind of problem by its label, and the labels are sentences a reader can pick', async () => {
    const text = visibleText(await pageHtml());
    for (const kind of PROBLEM_KINDS) {
      expect(text).toContain(KIND_LABEL[kind]);
    }
    expect(Object.keys(KIND_LABEL).sort()).toEqual([...PROBLEM_KINDS].sort());
  });

  test('🔴 the contact field is NOT required; the kind and the description are', async () => {
    const html = await pageHtml();
    const tags = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)];
    const form = tags.filter((m) => !/type="hidden"/.test(m[0]));
    expect(form.map((m) => m[1]).sort()).toEqual(['input', 'select', 'textarea']);

    const input = form.find((m) => m[1] === 'input')![0];
    expect(input).toMatch(/\bid="[^"]*-contact"/);
    expect(input).not.toMatch(/\brequired\b/);
    expect(input).toMatch(/aria-describedby="[^"]*-contact-hint"/);

    expect(form.find((m) => m[1] === 'select')![0]).toMatch(/\brequired\b/);
    expect(form.find((m) => m[1] === 'textarea')![0]).toMatch(/\brequired\b/);
  });

  test('🔴 no hidden field: nothing is collected that the reader cannot see', async () => {
    const html = await pageHtml();
    const section = /<section[^>]*data-testid="report-problem"[\s\S]*?<\/section>/.exec(html);
    expect(section).not.toBeNull();
    expect(section![0]).not.toMatch(/type="hidden"/);
    expect(section![0]).not.toMatch(/<input[^>]*\bname=/);
    // Exactly one text input (the contact), one select, one textarea.
    expect(section![0].match(/<input\b/g)?.length).toBe(1);
    expect(section![0].match(/<select\b/g)?.length).toBe(1);
    expect(section![0].match(/<textarea\b/g)?.length).toBe(1);
  });

  test('the field limits on the page are the API’s', async () => {
    const html = await pageHtml();
    expect(html).toContain(`maxLength="${MAX_DESCRIPTION}"`);
    expect(html).toContain(`maxLength="${MAX_CONTACT}"`);
  });
});

// 🔴 ДВА СПИСКИ ОДНОГО ПРАВИЛА. The kinds and the limits live in the API and
// here, because the two packages compile separately. The test reads the API
// file and compares, so neither copy can change alone.
test.describe('agrees with the API', () => {
  const rules = readFileSync(
    join(__dirname, '../../../api/src/reports/problem-reports.rules.ts'),
    'utf8',
  );

  test('the kinds are the API’s kinds, in the same order', () => {
    const m = /export const PROBLEM_KINDS = \[([\s\S]*?)\] as const;/.exec(rules);
    expect(m, 'PROBLEM_KINDS not found in the API file').not.toBeNull();
    const api = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(api).toEqual([...PROBLEM_KINDS]);
    expect(api.length).toBe(7);
  });

  test('the limits are the API’s limits', () => {
    const m = /export const LIMITS = \{([^}]*)\} as const;/.exec(rules);
    expect(m, 'LIMITS not found in the API file').not.toBeNull();
    const num = (name: string) => {
      const n = new RegExp(`${name}: (\\d+)`).exec(m![1]);
      expect(n, `LIMITS.${name} not found`).not.toBeNull();
      return Number(n![1]);
    };
    expect(num('description')).toBe(MAX_DESCRIPTION);
    expect(num('contact')).toBe(MAX_CONTACT);
  });
});

test.describe('what is sent', () => {
  const draft = { kind: 'closed' as const, description: '  Gate chained.  ', contact: '' };

  test('🔴 without a contact the key is absent from the JSON — not sent empty', () => {
    const body = requestBody('camping-report-test', draft);
    expect(JSON.stringify(body)).toBe(
      '{"slug":"camping-report-test","kind":"closed","description":"Gate chained."}',
    );
    expect('contact' in body).toBe(false);
  });

  test('with a contact it is sent, trimmed, and nothing else is added', () => {
    const body = requestBody('camping-report-test', { ...draft, contact: ' me@example.com ' });
    expect(Object.keys(body).sort()).toEqual(['contact', 'description', 'kind', 'slug']);
    expect(body.contact).toBe('me@example.com');
  });

  test('a blank contact passes validation — it is optional', () => {
    expect(validateDraft({ ...draft, contact: '   ' })).toEqual([]);
  });

  test('a missing kind, an empty description and an over-long one are caught at the field', () => {
    expect(validateDraft({ ...draft, kind: '' }).map((p) => p.field)).toEqual(['kind']);
    expect(validateDraft({ ...draft, description: ' ' }).map((p) => p.field)).toEqual([
      'description',
    ]);
    expect(
      validateDraft({ ...draft, description: 'x'.repeat(MAX_DESCRIPTION + 1) }).map(
        (p) => p.field,
      ),
    ).toEqual(['description']);
    expect(
      validateDraft({ ...draft, contact: 'x'.repeat(MAX_CONTACT + 1) }).map((p) => p.field),
    ).toEqual(['contact']);
  });
});

test.describe('sending', () => {
  const body: ReportBody = { slug: 's', kind: 'closed', description: 'd' };

  test('🔴 with no API address nothing is sent and the form says so', async () => {
    let calls = 0;
    const outcome = await sendReport(body, '', async () => {
      calls += 1;
      return new Response('', { status: 201 });
    });
    expect(outcome).toBe('unavailable');
    expect(calls).toBe(0);
    expect(messageFor('unavailable')).toContain('Nothing was sent');
  });

  test('posts JSON to /problem-reports, without credentials, and the body is the body', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const outcome = await sendReport(body, 'https://api.example', async (url, init) => {
      seen = { url, init };
      return new Response('{"ok":true}', { status: 201 });
    });
    expect(outcome).toBe('sent');
    expect(seen!.url).toBe('https://api.example/problem-reports');
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.credentials).toBe('omit');
    expect((seen!.init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect(seen!.init.body).toBe(JSON.stringify(body));
  });

  test('each answer of the API is one word to the reader', () => {
    expect(interpret(201)).toBe('sent');
    expect(interpret(400)).toBe('invalid');
    expect(interpret(404)).toBe('unknown_campsite');
    expect(interpret(429)).toBe('throttled');
    expect(interpret(500)).toBe('failed');
    expect(interpret(503)).toBe('failed');
  });

  test('a network failure is "failed", not an exception in the page', async () => {
    const outcome = await sendReport(body, 'https://api.example', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(outcome).toBe('failed');
  });
});

// ── The campsite page stays static ──────────────────────────────────────
//
// The form is a client island; the page that carries it is built once for
// every campsite. Nothing in the page or in anything it imports may read a
// request — the same walk as hub-screens.spec.tsx (г), from this page.
test('🔴 the campsite page and everything it imports read no request', () => {
  const SRC = resolve(__dirname, '..', '..', 'src');
  const page = join(SRC, 'app', 'camping', '[country]', '[region]', '[slug]', 'page.tsx');
  const seen = walkImportGraph(SRC, [page]);

  // Anchor: the walk reached the form, or it proves nothing about it.
  const names = [...seen].map((f) => f.slice(SRC.length + 1));
  expect(names).toContain('components/report-problem.tsx');
  expect(names).toContain('lib/problem-report.ts');
  expect(names).toContain('lib/api.ts');
  expect(seen.size).toBeGreaterThan(30);

  const offenders = requestReaders(SRC, seen);
  if (/\bsearchParams\b/.test(readFileSync(page, 'utf8'))) {
    offenders.push('page.tsx: searchParams in a page');
  }
  expect(offenders).toEqual([]);
});
