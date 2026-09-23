import { expect, test, type Page } from '@playwright/test';
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
  test('every one of them exists and says which version it is', async ({
    page,
  }) => {
    for (const p of LEGAL_PAGES) {
      const res = await page.goto(legalPath(p.slug));
      expect(res?.status(), `${p.slug} did not load`).toBeLessThan(400);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.title);
      await expect(page.getByTestId('legal-version')).toContainText(p.version);
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
  test('attribution appears on every page, as the licence requires', async ({
    page,
  }) => {
    for (const path of ['/', '/camping', '/map', '/legal/privacy']) {
      await page.goto(path);
      const footer = page.locator('footer');
      await expect(footer, `${path} lost its attribution`).toContainText(
        'OpenStreetMap contributors',
      );
      await expect(footer).toContainText('Open Database License');
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
