import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LEGAL_PAGES, legalPath } from '@/lib/legal';
import { CONSENT_KEY } from '@/lib/consent';

// CAMP-56 — the legal pages and the cookie banner.
//
// 🔴 The first test is the one a supervisory authority actually runs.
// They open the site with devtools and look at what was stored before
// anything was clicked. Everything else here is secondary to that.

const stored = (page: Page) =>
  page.evaluate((key) => {
    const out: Record<string, string | null> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        out[k] = localStorage.getItem(k);
      }
    } catch {
      /* blocked storage reads as empty, which is also fine */
    }
    return { local: out, consent: out[key] ?? null };
  }, CONSENT_KEY);

test.describe('cookie consent', () => {
  test('🔴 nothing is stored, and no cookie is set, before a choice', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('cookie-banner')).toBeVisible();

    const { local, consent } = await stored(page);
    expect(consent, 'a decision was recorded before one was made').toBeNull();
    expect(
      Object.keys(local),
      `something was stored before consent: ${Object.keys(local).join(', ')}`,
    ).toHaveLength(0);

    // Cookies too — the banner promises none, and the promise is testable.
    expect(
      await context.cookies(),
      'a cookie was set before the reader answered',
    ).toHaveLength(0);
  });

  // 🔴 GDPR Art. 4(11): consent must be freely given. A prominent Accept
  // beside a faint Reject is the single most-fined dark pattern in
  // Europe, so "equally prominent" is measured here rather than promised.
  test('🔴 reject is exactly as prominent as accept', async ({ page }) => {
    await page.goto('/');
    const reject = page.getByTestId('cookie-reject');
    const accept = page.getByTestId('cookie-accept');

    const [r, a] = [await reject.boundingBox(), await accept.boundingBox()];
    expect(r && a).toBeTruthy();

    expect(r!.height, 'the buttons are different heights').toBe(a!.height);
    // Widths follow their labels, which are both six letters; anything
    // beyond a tenth means one has been given extra weight.
    expect(Math.abs(r!.width - a!.width) / a!.width).toBeLessThan(0.1);

    const style = (el: typeof reject) =>
      el.evaluate((n) => {
        const s = getComputedStyle(n);
        return {
          weight: s.fontWeight,
          size: s.fontSize,
          bg: s.backgroundColor,
          colour: s.color,
          opacity: s.opacity,
        };
      });
    expect(await style(reject)).toEqual(await style(accept));
  });

  // 🔴 Measured, because the cookie policy promises it in words. The
  // first draft of the banner was 31% of an iPhone screen and covered the
  // centre of the map — a cookie wall by accident. A fifth of the
  // viewport is the line: below it the banner is a notice, above it the
  // banner is an obstacle.
  test('🔴 the banner never takes more than a fifth of the screen', async ({
    page,
  }) => {
    await page.goto('/');
    const box = await page.getByTestId('cookie-banner').boundingBox();
    const vp = page.viewportSize()!;
    expect(box).toBeTruthy();
    expect(
      box!.height / vp.height,
      `the banner covers ${Math.round((100 * box!.height) / vp.height)}% of the screen`,
    ).toBeLessThan(0.2);
  });

  test('the banner blocks nothing — the site works without answering', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('cookie-banner')).toBeVisible();

    // No overlay, no scroll lock: an ordinary link still works with the
    // banner up. Ignoring it is a valid state, and it is not consent.
    await page.getByRole('link', { name: 'Campsites' }).first().click();
    await expect(page).toHaveURL(/\/camping/);
    expect((await stored(page)).consent).toBeNull();
  });

  test('rejecting is one click, and it sticks', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('cookie-reject').click();
    await expect(page.getByTestId('cookie-banner')).toBeHidden();

    const { consent } = await stored(page);
    expect(consent).toContain('rejected');

    // And it is not asked again on the next page.
    await page.goto('/camping');
    await expect(page.getByTestId('cookie-banner')).toBeHidden();
  });

  test('accepting is recorded with its policy version', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('cookie-accept').click();
    await expect(page.getByTestId('cookie-banner')).toBeHidden();

    const { consent } = await stored(page);
    const record = JSON.parse(consent!);
    expect(record.choice).toBe('accepted');
    expect(record.version).toBeTruthy();
    expect(Date.parse(record.at)).not.toBeNaN();
  });

  // 🔴 GDPR Art. 7(3): withdrawing must be as easy as giving. One link,
  // on every page, in the footer.
  test('the decision can be changed again from any page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('cookie-accept').click();
    await expect(page.getByTestId('cookie-banner')).toBeHidden();

    await page.goto('/camping');
    await page.getByTestId('cookie-settings').click();
    await expect(page.getByTestId('cookie-banner')).toBeVisible();

    await page.getByTestId('cookie-reject').click();
    expect((await stored(page)).consent).toContain('rejected');
  });
});

test.describe('the legal pages', () => {
  // 🔴 Fetched, not navigated to — six browser navigations in one test.
  //
  // This is asking what the SERVED HTML says, and a browser adds nothing
  // to that answer except six page loads. Under CI's parallelism it
  // timed out at 30 s on mobile-safari and passed on the retry, which
  // the flaky guard caught. The same fix the i18n suite already needed,
  // for the same reason: use `request` when the question is about the
  // document rather than about the rendering.
  test('every one of them exists and says which version it is', async ({
    request,
  }) => {
    for (const p of LEGAL_PAGES) {
      const res = await request.get(legalPath(p.slug));
      expect(res.status(), `${p.slug} did not load`).toBeLessThan(400);
      const html = await res.text();

      // 🔴 The heading's text, captured up to the first tag rather than
      // stripped of tags afterwards.
      //
      // The earlier version ran `.replace(/<[^>]+>/g, '')` over the
      // captured HTML, and CodeQL flagged it as incomplete
      // multi-character sanitization — correctly, as a pattern. Nothing
      // here is rendered, so there was no vulnerability, but the pattern
      // has no business in the codebase either: a regex that removes
      // tags is the one everybody copies into a place where it DOES get
      // rendered.
      //
      // Nothing else is needed, because the heading is `{page.title}`
      // and nothing more. Verified against every built legal page: each
      // h1 holds plain text. If markup is ever nested inside one, this
      // capture comes back empty and the test says so, which is the
      // honest outcome — the silent strip would have hidden it.
      const h1 = /<h1[^>]*>([^<]*)<\/h1>/i.exec(html)?.[1] ?? '';
      expect(h1.trim(), `${p.slug} has the wrong heading`).toContain(p.title);

      const version =
        /data-testid="legal-version"[\s\S]{0,400}?Version[^0-9]{0,10}([0-9.]+)/.exec(
          html,
        )?.[1] ?? '';
      expect(version, `${p.slug} does not state its version`).toContain(
        p.version,
      );
    }
  });

  // A legal page nobody can find is a legal page that does not count.
  test('all of them are reachable from the footer of an ordinary page', async ({
    page,
  }) => {
    await page.goto('/camping');
    const footer = page.getByRole('navigation', { name: 'Legal' });
    for (const p of LEGAL_PAGES) {
      await expect(
        footer.getByRole('link', { name: p.title }),
        `${p.title} is missing from the footer`,
      ).toBeVisible();
    }
  });

  test('an invented legal URL is a 404, not an empty page', async ({
    request,
  }) => {
    // A blank document at /legal/… reads as "they have no terms".
    const res = await request.get('/legal/whatever');
    expect(res.status()).toBe(404);
  });

  // 🔴 ODbL attribution is a CONDITION of the licence the whole dataset
  // comes under, not a courtesy — break it and we lose the right to use
  // the data at all. It has to be on every page, not only where we
  // remembered.
  // 🔴 Fetched, not navigated to — the third time this file has learned
  // the same lesson.
  //
  // Four `page.goto` for a question about the served HTML, and one of
  // them is `/map`, which boots MapLibre and pulls a 2.4 MB snapshot. It
  // timed out at 30 s on the tablet project and passed on the retry; the
  // flaky guard caught it. The attribution is rendered into the markup by
  // the server — a browser adds nothing to the answer except four page
  // loads and a map.
  test('attribution appears on every page, as the licence requires', async ({
    request,
  }) => {
    for (const path of ['/', '/camping', '/map', '/legal/privacy']) {
      const html = await (await request.get(path)).text();
      // The footer, not the whole document: `<body>` also carries the
      // JSON-LD, and a match there would pass with the visible notice
      // gone — which is the exact failure the licence cares about.
      const footer = /<footer[\s\S]*<\/footer>/i.exec(html)?.[0] ?? '';
      expect(footer, `${path} has no footer at all`).toBeTruthy();
      expect(footer, `${path} lost its attribution`).toContain(
        'OpenStreetMap contributors',
      );
      expect(footer, `${path} lost the licence name`).toContain(
        'Open Database License',
      );
    }
  });

  test('the operator is identifiable from any page', async ({ page }) => {
    await page.goto('/camping');
    const footer = page.locator('footer');
    await expect(footer).toContainText('UTD BV');
    await expect(footer).toContainText('Belgium');
  });
});

test.describe('security.txt', () => {
  // 🔴 RFC 9116 makes `Expires` mandatory and requires it to be in the
  // future. A file past its expiry is not merely untidy — the RFC says it
  // should be treated as no longer valid, so the contact stops counting.
  // Ours is computed at build time; this proves the arithmetic.
  test('is served, names a contact, and has not expired', async ({
    request,
  }) => {
    const res = await request.get('/.well-known/security.txt');
    expect(res.ok(), 'security.txt is not served').toBe(true);
    expect(res.headers()['content-type']).toContain('text/plain');

    const body = await res.text();
    expect(body).toContain('Contact: mailto:');
    expect(body).toContain('Canonical:');

    const expires = /^Expires:\s*(.+)$/m.exec(body)?.[1];
    expect(expires, 'Expires is required by RFC 9116').toBeTruthy();
    const when = Date.parse(expires!.trim());
    expect(Number.isNaN(when)).toBe(false);
    expect(when, 'security.txt has expired').toBeGreaterThan(Date.now());
    // And inside the one-year ceiling the RFC sets.
    expect(when).toBeLessThan(Date.now() + 366 * 24 * 60 * 60 * 1000);
  });
});

test.describe('the banner is usable without a mouse', () => {
  // 🔴 A consent control that a keyboard or a screen reader cannot use
  // is not a choice freely given — it is a choice only some readers get
  // to make. axe runs over the page with the banner up, which is the
  // state the existing home-page check never sees.
  test('carries no accessibility violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('cookie-banner')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      results.violations.map((v) => `${v.id}: ${v.description}`),
      'the cookie banner introduced accessibility violations',
    ).toEqual([]);
  });

  test('both answers are reachable and operable by keyboard', async ({
    page,
  }) => {
    await page.goto('/');
    const reject = page.getByTestId('cookie-reject');
    await reject.focus();
    await expect(reject).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cookie-banner')).toBeHidden();
  });
});

test.describe('🔴 the warning is where the card asks for it', () => {
  // CAMP-56 item 4, verbatim: "дрібний лінк у футері юридично слабший —
  // попередження має бути видиме В МОМЕНТ ДІЇ". The moment of action for
  // a campsite page is the moment somebody decides to drive there.
  test('a campsite page carries it in the page, not only in the footer', async ({
    page,
    request,
  }) => {
    const spots: { country: string; region: string; slug: string }[] = await (
      await request.get(`${process.env.API_BASE_URL ?? 'http://localhost:3001'}/spots/index`)
    ).json();
    const s = spots[0];
    await page.goto(`/camping/${s.country}/${s.region}/${s.slug}`);

    const notice = page.getByTestId('travel-notice');
    await expect(notice).toBeVisible();

    // 🔴 In the body, not inside the footer — which is the whole point.
    expect(
      await notice.evaluate((n) => !!n.closest('footer')),
      'the notice is inside the footer, which the card calls legally weaker',
    ).toBe(false);

    // The two facts it must carry.
    await expect(notice).toContainText('nobody from CampTribe has visited');
    await expect(notice).toContainText('not permission to camp there');
    await expect(
      notice.getByRole('link', { name: /what we do and do not know/i }),
    ).toBeVisible();
  });

  test('and it cannot be dismissed away', async ({ page, request }) => {
    const spots: { country: string; region: string; slug: string }[] = await (
      await request.get(`${process.env.API_BASE_URL ?? 'http://localhost:3001'}/spots/index`)
    ).json();
    const s = spots[0];
    await page.goto(`/camping/${s.country}/${s.region}/${s.slug}`);
    // A notice a reader can close is a notice half of them never see.
    await expect(
      page.getByTestId('travel-notice').getByRole('button'),
    ).toHaveCount(0);
  });
});
