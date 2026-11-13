import { test, expect, type Page } from './api-request';
import { hasWebGl } from '../map-ready';

/**
 * CAMP-502 — the «!» pins on the campsite map, in a real browser.
 *
 * 🔴 WHY THIS FILE EXISTS (review of #557). The pins went out with no test:
 * a `title` nobody on a touch screen can read, and a view fitted to an airport
 * 5 km away, which left the campsite a dot on its own page.
 *
 * The fixture (`ci-seed-page-disturbance.sql`) gives ONE campsite a motorway
 * 556 m north and an airport 4.4 km north; every other campsite has nothing
 * near. Both pages are found by ASKING THE API, never by naming a slug.
 *
 * MUTATIONS (done, see the PR): fit every pin again → the zoom test goes red;
 * remove the click handler → the note never opens; show the note without the
 * caveat → red; drop the legend → red.
 */

type Ref = { country: string; region: string; slug: string };
const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

async function findSpots(request: Page['request']) {
  const res = await request.get(`${API}/spots/index`);
  expect(res.status(), `API відмовив: ${res.status()}`).toBe(200);
  const spots = (await res.json()) as Ref[];
  let withPins: Ref | null = null;
  let without: Ref | null = null;
  // The seeded row is the first by (country, region, slug) — the order of the
  // index. Twelve, not all: a refusal must not read as "the fixture is empty".
  for (const s of spots.slice(0, 12)) {
    if (withPins && without) break;
    const detail = await request.get(`${API}/spots/${s.country}/${s.region}/${s.slug}`);
    expect(
      detail.status(),
      `API відмовив на ${s.slug}: ${detail.status()} — це поломка API, а НЕ порожня фікстура`,
    ).toBe(200);
    const body = (await detail.json()) as {
      spot?: { disturbance?: { items?: { kind: string }[] } };
    };
    const kinds = (body.spot?.disturbance?.items ?? []).map((i) => i.kind);
    if (kinds.includes('road') && kinds.includes('airport') && !withPins) withPins = s;
    if (kinds.length === 0 && !without) without = s;
  }
  expect(
    withPins,
    'у фікстурі жоден кемпінг не має і дороги, і аеропорту — гілка пінів недосяжна',
  ).not.toBeNull();
  expect(
    without,
    'у фікстурі кожен кемпінг має обʼєкт поруч — гілка «нічого поруч» недосяжна',
  ).not.toBeNull();
  return { withPins: withPins!, without: without! };
}
const url = (s: Ref) => `/camping/${s.country}/${s.region}/${s.slug}`;
const CAVEAT = 'We have not measured noise or air on the spot';

test.describe('🔴 CAMP-502 — піни «можливий дискомфорт» на мапі кемпінга', () => {
  test('під мапою у відданій сторінці: кожен пін названо з відстанню, і застереження поруч', async ({
    page,
    request,
  }) => {
    const { withPins } = await findSpots(request);
    await page.goto(url(withPins));
    const legend = page.getByTestId('disturbance-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('Possible disturbance: Motorway or trunk road, 56');
    // 🔴 аеропорт поза першим кадром мапи — про нього читач дізнається ТУТ
    await expect(legend).toContainText('Possible disturbance: Airport, 4.4 km');
    await expect(legend).toContainText(CAVEAT);
    // рядок веде до блоку, і блок там є
    await legend.getByRole('link').click();
    await expect(page.locator('#camp-disturbance-heading')).toBeInViewport();
    await expect(page.getByTestId('camp-disturbance')).toContainText(CAVEAT);
  });

  test('🔴 пін натискається (дотик, клавіатура) і показує застереження, а не лише title', async ({
    page,
    request,
  }) => {
    const { withPins } = await findSpots(request);
    await page.goto(url(withPins));
    const webgl = await hasWebGl(page);
    if (!webgl) {
      // Без WebGL мапи немає взагалі — тоді пінів немає, а рядок під мапою Є:
      // саме для цього випадку він і живе в HTML, а не в острові.
      await expect(page.getByTestId('site-map-fallback')).toHaveCount(1);
      await expect(page.getByTestId('disturbance-legend')).toContainText(CAVEAT);
      return;
    }
    const pins = page.getByTestId('disturbance-marker');
    await expect(pins).toHaveCount(2, { timeout: 30_000 });
    const road = page.locator('[data-testid="disturbance-marker"][data-kind="road"]');
    await expect(road).toHaveAttribute('role', 'button');
    await expect(road).toHaveAttribute('aria-expanded', 'false');
    await expect(road).not.toHaveAttribute('title', /.*/);
    await expect(page.getByTestId('disturbance-note')).toHaveCount(0);

    await road.click();
    const note = page.getByTestId('disturbance-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Possible disturbance: Motorway or trunk road, 56');
    await expect(note).toContainText(CAVEAT);
    await expect(road).toHaveAttribute('aria-expanded', 'true');

    // клавіатура: Escape закриває, Enter відкриває знову
    // дотик по самій нотатці її прибирає (на телефоні вона закриває пів мапи)
    await note.click();
    await expect(note).toHaveCount(0);
    await road.click();
    await expect(note).toBeVisible();
    await road.focus();
    await page.keyboard.press('Escape');
    await expect(note).toHaveCount(0);
    await expect(road).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('disturbance-note')).toContainText(CAVEAT);
  });

  test('🔴 аеропорт за 4,4 км не віддаляє мапу: кемпінг і дорога в кадрі, аеропорт — ні', async ({
    page,
    request,
  }) => {
    const { withPins } = await findSpots(request);
    await page.goto(url(withPins));
    if (!(await hasWebGl(page))) {
      await expect(page.getByTestId('site-map-fallback')).toHaveCount(1);
      return;
    }
    const box = page.getByTestId('site-map');
    // цей кемпінг має обрис: остаточний кадр ставить обробник `load`
    await expect(box).toHaveAttribute('data-outline-layer', 'true', {
      timeout: 30_000,
    });
    // 🔴 Заміряно 13.11.2026 на цій сторінці: z15,00 на 990×742 і z13,96 на
    // 341×258 (телефон). Кадр, що вміщає ще й аеропорт за 4,4 км, утричі
    // ширший за потрібний — це три рівні зуму нижче, ≈ z11.
    const zoom = Number(await box.getAttribute('data-zoom'));
    expect(zoom, `мапа відкрилась на z${zoom}`).toBeGreaterThanOrEqual(13);
    expect(zoom).toBeLessThanOrEqual(15);

    const frame = (await box.boundingBox())!;
    const inside = async (kind: string) => {
      const b = (await page
        .locator(`[data-testid="disturbance-marker"][data-kind="${kind}"]`)
        .boundingBox())!;
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      return (
        cx >= frame.x &&
        cx <= frame.x + frame.width &&
        cy >= frame.y &&
        cy <= frame.y + frame.height
      );
    };
    expect(await inside('road'), 'пін дороги за 556 м мусить бути в кадрі').toBe(true);
    expect(await inside('airport'), 'пін аеропорту за 4,4 км НЕ мусить стискати кадр').toBe(false);
  });

  test('🔴 де поруч нічого немає — ні блоку, ні пінів, ні рядка під мапою', async ({
    page,
    request,
  }) => {
    const { without } = await findSpots(request);
    await page.goto(url(without));
    await expect(page.getByTestId('campsite-media')).toBeVisible();
    if (await hasWebGl(page))
      await expect(page.getByTestId('site-map')).toHaveAttribute('data-map-loaded', 'true', {
        timeout: 30_000,
      });
    await expect(page.getByTestId('disturbance-legend')).toHaveCount(0);
    await expect(page.getByTestId('disturbance-marker')).toHaveCount(0);
    await expect(page.getByTestId('camp-disturbance')).toHaveCount(0);
  });
});
