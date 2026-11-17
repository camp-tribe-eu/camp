import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import ContactPage from '@/app/contact/page';
import {
  EMPTY_DRAFT,
  FILL_MARGIN_MS,
  LIMITS,
  MIN_FILL_MS,
  MIN_MESSAGE,
  interpret,
  messageFor,
  requestBody,
  sendContact,
  validateDraft,
  waitBeforeSending,
  type ContactOutcome,
} from '@/lib/contact-form';
import { renderAsyncComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-441, review item 31 — the form on /contact.
//
// 🔴 EVERY CLAIM ABOUT THE PAGE READS THE HTML THE PAGE RENDERS — the real
// `ContactPage` with `fetch` swapped for a canned CMS — through the same
// `visibleText` the other page specs use. Not a constant, not a class name,
// not a `data-testid`, not an `sr-only` caption. The CMS card below is
// written in THIS file and is deliberately not the one the migration seeds.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const section = (s: Record<string, unknown>) => ({
  type: 'prose', variant: null, slot: null, heading: null, subheading: null,
  body: null, imageUrl: null, imageAlt: null, ctaHref: null, ctaLabel: null,
  items: [], ...s,
});

const PAGE = {
  slug: 'contact', title: 'Contact', metaTitle: null,
  metaDescription: 'Write to us.', noindex: false,
  sections: [
    section({ slot: 'intro', body: 'Canned intro sentence.' }),
    section({ slot: 'aside', type: 'card', heading: 'Canned card', body: 'Canned card text.', ctaLabel: 'Email us', ctaHref: 'mailto:{{contact.email}}' }),
  ],
};

async function pageHtml(): Promise<string> {
  const real = globalThis.fetch;
  globalThis.fetch = ((u: string) =>
    Promise.resolve().then(() =>
      new URL(String(u)).pathname === '/pages/contact' ? json(PAGE) : json({}, 404),
    )) as typeof fetch;
  try {
    return await renderAsyncComponent(ContactPage, undefined as never);
  } finally {
    globalThis.fetch = real;
  }
}

const formOf = (html: string) => {
  const m = /<section[^>]*data-testid="contact-form"[\s\S]*?<\/section>/.exec(html);
  expect(m, 'the form is not in the page').not.toBeNull();
  return m![0];
};

test.describe('the contact page carries the form', () => {
  test('anchor: the page renders, with the canned CMS text beside the form', async () => {
    const text = visibleText(await pageHtml());
    expect(text).toContain('Canned intro sentence.');
    expect(text).toContain('Canned card text.');
    expect(text).toContain('Write to us');
  });

  test('🔴 a form with name, email, optional subject and a message, and a send button', async () => {
    const form = formOf(await pageHtml());
    const text = visibleText(form);
    for (const label of ['Name', 'Email', 'Subject', 'Message', 'Send message'])
      expect(text, `no «${label}» on the form`).toContain(label);
    expect(text).toContain('(optional)');
    expect(form).toMatch(/<form\b/);
    const tags = [...form.matchAll(/<(input|textarea)\b[^>]*>/g)].map((m) => m[0]);
    // name, email, subject, trap — and the textarea
    expect(tags.filter((t) => t.startsWith('<input')).length).toBe(4);
    expect(tags.filter((t) => t.startsWith('<textarea')).length).toBe(1);
    const email = tags.find((t) => /type="email"/.test(t))!;
    expect(email).toMatch(/\brequired\b/);
    expect(email).toMatch(/autoComplete="email"/i);
    // the subject is the one visible field that is not required
    const subject = tags.find((t) => /-subject"/.test(t))!;
    expect(subject).not.toMatch(/\brequired\b/);
  });

  test('every visible field has a label that points at it', async () => {
    const form = formOf(await pageHtml());
    for (const id of ['name', 'email', 'subject', 'message']) {
      const control = new RegExp(`<(?:input|textarea)\\b[^>]*\\bid="([^"]*-${id})"`).exec(form);
      expect(control, `no control for ${id}`).not.toBeNull();
      expect(form, `no label for ${control![1]}`).toContain(`for="${control![1]}"`);
    }
  });

  test('🔴 the sentence under the button says what is sent, where to, for how long — and links to the policy section', async () => {
    const form = formOf(await pageHtml());
    const p = /<p\b[^>]*data-testid="contact-privacy"[^>]*>[\s\S]*?<\/p>/.exec(form);
    expect(p, 'no privacy sentence').not.toBeNull();
    const text = visibleText(p![0]);
    expect(text).toContain('as one email to hello@camptribe.eu');
    expect(text).toContain('Hetzner in Germany');
    expect(text).toContain('not stored on this website’s database');
    expect(text).toContain('as long as it takes to deal with it and a reasonable period afterwards');
    expect(p![0]).toContain('href="/legal/privacy#writing"');
    // and it comes AFTER the button, not before the fields
    expect(form.indexOf('data-testid="contact-privacy"')).toBeGreaterThan(form.indexOf('Send message'));
  });

  test('🔴 no tick-box: the basis is answering a request, not consent', async () => {
    const form = formOf(await pageHtml());
    expect(form).not.toMatch(/type="checkbox"/);
    expect(visibleText(form)).not.toMatch(/I agree|I consent|consent to/i);
  });

  test('🔴 without JavaScript the page says so and gives the address; the fields are not live yet', async () => {
    const form = formOf(await pageHtml());
    expect(form).toMatch(/<noscript>[\s\S]*This form needs JavaScript[\s\S]*href="mailto:hello@camptribe\.eu"[\s\S]*<\/noscript>/);
    expect(visibleText(form)).toContain('The form comes alive when the page finishes loading.');
    const live = [...form.matchAll(/<(input|textarea|button)\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((t) => !/aria-hidden|tabindex="-1"/.test(t));
    expect(live.length).toBeGreaterThanOrEqual(5);
    // the ATTRIBUTE, not the `disabled:opacity-60` class that every field carries
    for (const t of live) expect(t, `a live control before hydration: ${t}`).toMatch(/\sdisabled(=""|\s|\/|>)/);
  });

  test('🔴 the trap is in the HTML, out of the tab order, hidden from assistive technology, named so autofill skips it', async () => {
    const form = formOf(await pageHtml());
    const wrap = /<div\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/div>/.exec(form);
    expect(wrap, 'no hidden trap field').not.toBeNull();
    expect(wrap![0]).toMatch(/tabindex="-1"/i);
    expect(wrap![0]).toMatch(/autoComplete="off"/i);
    expect(wrap![0]).toMatch(/name="leaveBlank"/);
    // Whether it is really off-screen is a question for a browser, not for
    // `visibleText` (which knows no offset): tests/e2e/contact.spec.ts measures it.
  });

  test('the CMS card with the email button stays beside the form, as the way round', async () => {
    const html = await pageHtml();
    expect(html).toContain('href="mailto:hello@camptribe.eu"');
    expect(visibleText(html)).toContain('Canned card');
  });

  test('the field limits on the page are the API’s', async () => {
    const form = formOf(await pageHtml());
    for (const n of Object.values(LIMITS)) expect(form).toContain(`maxLength="${n}"`);
  });
});

test.describe('what the page sends', () => {
  const draft = { name: ' Anna ', email: ' anna@example.eu ', subject: ' ', message: '  A closed campsite, gate chained.  ' };

  test('the body is trimmed, carries the empty trap and the open time, and a blank subject is left out', () => {
    expect(requestBody(draft, 4321.7)).toEqual({
      name: 'Anna', email: 'anna@example.eu', message: 'A closed campsite, gate chained.',
      leaveBlank: '', elapsedMs: 4322,
    });
    expect(requestBody({ ...draft, subject: ' Hi ' }, 4000).subject).toBe('Hi');
  });

  test('the check before sending finds what the API would refuse', () => {
    expect(validateDraft(draft)).toEqual([]);
    expect(validateDraft(EMPTY_DRAFT).map((p) => p.field)).toEqual(['name', 'email', 'message']);
    for (const email of ['a', 'a@b', 'a b@c.eu', 'a@b.eu,c@d.eu', 'Anna <a@b.eu>'])
      expect(validateDraft({ ...draft, email }).map((p) => p.field), email).toEqual(['email']);
    expect(validateDraft({ ...draft, message: 'short' }).map((p) => p.field)).toEqual(['message']);
    expect(validateDraft({ ...draft, name: 'x'.repeat(LIMITS.name + 1) }).map((p) => p.field)).toEqual(['name']);
    expect(validateDraft({ ...draft, name: 'A\nB' }).map((p) => p.field)).toEqual(['name']);
  });

  test('🔴 a person is never «too fast»: the button waits out what is left of the minimum, with a margin', () => {
    expect(waitBeforeSending(0)).toBe(MIN_FILL_MS + FILL_MARGIN_MS);
    expect(waitBeforeSending(MIN_FILL_MS)).toBe(FILL_MARGIN_MS);
    expect(waitBeforeSending(MIN_FILL_MS + FILL_MARGIN_MS)).toBe(0);
    expect(waitBeforeSending(60_000)).toBe(0);
    // what is sent after waiting is never under the API's minimum
    for (const opened of [0, 1000, 2999, 3000, 10_000])
      expect(opened + waitBeforeSending(opened)).toBeGreaterThanOrEqual(MIN_FILL_MS);
  });

  test('statuses become outcomes, and every failure names the address', () => {
    expect(interpret(200)).toBe('sent');
    expect(interpret(400)).toBe('invalid');
    expect(interpret(429)).toBe('throttled');
    for (const s of [500, 502, 503, 404]) expect(interpret(s)).toBe('failed');
    for (const o of ['throttled', 'unavailable', 'failed'] as ContactOutcome[])
      expect(messageFor(o), o).toContain('hello@camptribe.eu');
    expect(messageFor('sent')).not.toContain('hello@');
  });

  test('🔴 an empty API address sends nothing and says so; a real one gets one POST without credentials', async () => {
    let calls = 0;
    const body = requestBody(draft, 5000);
    expect(await sendContact(body, '', async () => { calls++; return new Response('{}'); })).toBe('unavailable');
    expect(calls).toBe(0);

    let seen: { url: string; init: RequestInit } | null = null;
    const out = await sendContact(body, 'https://api.example', async (url, init) => {
      seen = { url, init };
      return new Response('{"ok":true}', { status: 200 });
    });
    expect(out).toBe('sent');
    expect(seen!.url).toBe('https://api.example/contact');
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.credentials).toBe('omit');
    expect(JSON.parse(String(seen!.init.body))).toEqual(body);

    expect(await sendContact(body, 'https://api.example', async () => { throw new Error('offline'); })).toBe('failed');
    expect(await sendContact(body, 'https://api.example', async () => new Response('{}', { status: 503 }))).toBe('failed');
    expect(await sendContact(body, 'https://api.example', async () => new Response('{}', { status: 429 }))).toBe('throttled');
  });
});

// 🔴 TWO LISTS OF ONE RULE. The limits live in the API and here, because the
// two packages compile separately. The test reads the API file and compares.
test.describe('agrees with the API', () => {
  const rules = readFileSync(join(__dirname, '../../../api/src/contact/contact.rules.ts'), 'utf8');
  const num = (re: RegExp) => Number(re.exec(rules)?.[1]);

  test('the limits, the minimum message and the minimum open time are the same numbers', () => {
    expect(num(/name:\s*(\d+)/)).toBe(LIMITS.name);
    expect(num(/email:\s*(\d+)/)).toBe(LIMITS.email);
    expect(num(/subject:\s*(\d+)/)).toBe(LIMITS.subject);
    expect(num(/message:\s*(\d+)/)).toBe(LIMITS.message);
    expect(num(/MIN_MESSAGE\s*=\s*(\d+)/)).toBe(MIN_MESSAGE);
    expect(num(/MIN_FILL_MS\s*=\s*(\d+)/)).toBe(MIN_FILL_MS);
  });

  test('the page sends exactly the keys the API allows, and no others', () => {
    const allowed = /new Set\(\[([\s\S]*?)\]\)/.exec(rules)![1]
      .match(/'(\w+)'/g)!.map((s) => s.replace(/'/g, '')).sort();
    const sent = Object.keys(requestBody({ ...EMPTY_DRAFT, subject: 's' }, 5000)).sort();
    expect(sent).toEqual(allowed);
  });
});
