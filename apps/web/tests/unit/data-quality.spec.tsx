import { expect, test } from '@playwright/test';

import DataQualityPage, { dynamic, metadata } from '@/app/internal/data-quality/page';
import {
  DataQualityUnavailable,
  DataQualityView,
} from '@/components/data-quality-view';
import {
  getDataQuality,
  readDataQuality,
  share,
  type QualityReport,
} from '@/lib/data-quality';
import { robotsFor } from '@/lib/robots-rules';
import { STATIC_HUBS } from '@/lib/sitemap';
import { renderAsyncComponent, renderComponent } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-522 — `/internal/data-quality`.
 *
 * 🔴 «СПОСІБ ПЕРЕВІРКИ» З КАРТКИ, ДОСЛІВНО: «кожне число на дашборді має
 * поруч запит, яким воно отримане; мутація — підмінити запит, число
 * змінюється й це видно». Тому все нижче читає ВІДДАНУ HTML — видимий
 * текст блоку, а не проп, не клас і не атрибут. `data-measure` служить
 * лише адресою блоку; жодне твердження не стоїть на ньому.
 *
 * 🔴 ЗВІТ ТУТ НАПИСАНИЙ РУКОЮ, А НЕ ВЗЯТИЙ З API. Числа в ньому не
 * схожі ні одне на одне, ні на суми одне одного: якби сторінка
 * переплутала чисельник зі знаменником або рядок із сусіднім, збіг був
 * би неможливий. Відсотки пораховані на папері.
 */

const SQL_A = "SELECT NULL AS label, count(*) FILTER (WHERE s.missing_since IS NULL) AS n, count(*) AS of FROM camping_spots s";
const SQL_B = 'SELECT s.src AS label, count(*) FILTER (WHERE s.fresh) AS n, count(*) AS of FROM rows s GROUP BY 1';
const SQL_C = 'SELECT NULL AS label, count(*) FILTER (WHERE p.stars <> x.stars) AS n, count(*) AS of FROM pairs';
const SQL_D = 'SELECT NULL AS label, count(*) AS n, count(*) AS of FROM no_such_table';

const report = (): QualityReport => ({
  measuredAt: '2026-11-13T11:13:05Z',
  database: 'camptribe',
  groups: [
    ['unique', 'Unique objects, not rows'],
    ['current', 'Sources that are current'],
    ['contradictions', 'Contradictions between sources'],
    ['closed', 'Closed and inactive places'],
    ['cameras', 'Cameras that work'],
  ],
  lines: [
    { key: 'unique_campsites', group: 'unique', label: null, what: 'campsites, second copies folded in', ofWhat: 'rows ever imported', n: 52645, of: 63307, sql: SQL_A },
    { key: 'seen_lately', group: 'current', label: 'datatourisme', what: 'rows the source confirmed lately', ofWhat: 'rows the source still has, per source', n: 0, of: 8752, sql: SQL_B },
    { key: 'seen_lately', group: 'current', label: 'osm', what: 'rows the source confirmed lately', ofWhat: 'rows the source still has, per source', n: 47541, of: 48383, sql: SQL_B },
    { key: 'stars_differ', group: 'contradictions', label: null, what: 'pairs giving different stars', ofWhat: 'pairs in which both give stars', n: 0, of: 0, sql: SQL_C },
  ],
  failures: [
    { key: 'gone', group: 'closed', what: 'rows the source no longer has', sql: SQL_D, error: 'relation "no_such_table" does not exist' },
  ],
  notMeasured: [
    { key: 'closed_really', group: 'closed', what: 'campsites that have closed', why: 'Not measured: we hold no closure flag of our own.' },
  ],
});

const html = (r: QualityReport = report()) => renderComponent(DataQualityView, { report: r });

/** Видимий текст одного блоку — за атрибутом-адресою. */
function block(page: string, attr: string, key: string): string {
  const open = `<article class="[^"]*" ${attr}="${key}">`;
  const m = new RegExp(`${open}([\\s\\S]*?)</article>`).exec(page);
  expect(m, `блоку ${attr}=${key} на сторінці немає`).not.toBeNull();
  return visibleText((m as RegExpExecArray)[1]);
}

test('🔴 поруч із числом стоять його знаменник, частка і запит, яким воно отримане', () => {
  const text = block(html(), 'data-measure', 'unique_campsites');
  expect(text).toContain('campsites, second copies folded in');
  expect(text).toContain('52,645');
  expect(text).toContain('of 63,307');
  expect(text).toContain('Out of: rows ever imported.');
  // 52645 / 63307 = 0.83158…
  expect(text).toContain('83.2%');
  expect(text).toContain(SQL_A);
});

test('🔴 мутація з картки: підмінили запит — число й запит на сторінці змінились, і тільки в цьому блоці', () => {
  const before = html();
  const changed = report();
  const swapped = 'SELECT NULL AS label, count(*) AS n, count(*) AS of FROM camping_spots s';
  changed.lines[0] = { ...changed.lines[0], n: 63307, sql: swapped };
  const after = html(changed);

  const a = block(before, 'data-measure', 'unique_campsites');
  const b = block(after, 'data-measure', 'unique_campsites');
  expect(a).toContain('52,645');
  expect(a).toContain(SQL_A);
  expect(b).not.toContain('52,645');
  expect(b).not.toContain(SQL_A);
  expect(b).toContain(swapped);
  expect(b).toContain('63,307');
  expect(b).toContain('100.0%');
  // сусідній блок не зачеплено
  expect(block(after, 'data-measure', 'seen_lately')).toBe(
    block(before, 'data-measure', 'seen_lately'),
  );
});

test('розбивка: кожен рядок зі своїм числом і своїм знаменником, запит один на блок', () => {
  const page = html();
  const text = block(page, 'data-measure', 'seen_lately');
  // рядки йдуть у порядку звіту, кожен — підпис, число, знаменник, частка
  expect(text).toMatch(/datatourisme\s+0\s+of 8,752\s+0\.0%/);
  // 47541 / 48383 = 0.98259…
  expect(text).toMatch(/osm\s+47,541\s+of 48,383\s+98\.3%/);
  expect(text.split(SQL_B)).toHaveLength(2);
  // це один блок, а не два з однаковим ключем
  expect(page.match(/data-measure="seen_lately"/g)).toHaveLength(1);
});

test('🔴 нуль із нуля — це «нема на що ділити», а не 0% і не NaN', () => {
  const text = block(html(), 'data-measure', 'stars_differ');
  expect(text).toMatch(/\b0\s+of 0\s+nothing to divide by/);
  expect(text).not.toContain('%');
  expect(text).not.toContain('NaN');
  expect(text).toContain(SQL_C);
  expect(share(0, 0)).toBeNull();
  expect(share(0, 7)).toBe('0.0%');
});

test('🔴 міра, що впала, — це названий збій зі словами бази й запитом, а не нуль', () => {
  const text = block(html(), 'data-failed', 'gone');
  expect(text).toContain('rows the source no longer has');
  expect(text).toContain('No figure.');
  expect(text).toContain('relation "no_such_table" does not exist');
  expect(text).toContain(SQL_D);
  // у блоці збою немає жодного числа-результату
  expect(text.replace(SQL_D, '')).not.toMatch(/\d/);
});

test('🔴 те, чого не міряємо, написано словами на своєму місці', () => {
  const text = block(html(), 'data-gap', 'closed_really');
  expect(text).toContain('campsites that have closed');
  expect(text).toContain('Not measured: we hold no closure flag of our own.');
  expect(text).not.toMatch(/\d/);
});

test('розділ без жодної міри так і каже, а не лишає порожній заголовок', () => {
  const text = visibleText(html());
  expect(text).toMatch(/Cameras that work\s+Nothing is measured under this heading\./);
  // а розділи з мірами цього рядка не мають
  expect(text.match(/Nothing is measured under this heading\./g)).toHaveLength(1);
});

test('🔴 жоден рядок звіту не загубився: рядків із числом на сторінці стільки ж, скільки у звіті', () => {
  const r = report();
  const page = html(r);
  expect(page.match(/<tr [^>]*data-part="line"/g)).toHaveLength(r.lines.length);
  expect(page.match(/<article [^>]*data-failed=/g)).toHaveLength(r.failures.length);
  expect(page.match(/<article [^>]*data-gap=/g)).toHaveLength(r.notMeasured.length);
  // заголовки розділів — у порядку звіту
  const text = visibleText(page);
  const at = r.groups.map(([, title]) => text.indexOf(title));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((x, y) => x - y)).toEqual(at);
});

test('сторінка каже, коли й на якій базі заміряно — людською датою, не машинною', () => {
  const text = visibleText(html());
  expect(text).toContain('Measured 13 November 2026, 11:13 UTC on database camptribe');
  expect(text).not.toContain('2026-11-13T');
});

test('🔴 без звіту сторінка каже причину і не малює жодного числа', () => {
  const text = visibleText(
    renderComponent(DataQualityUnavailable, {
      why: 'The API answered 404 to the request for the report.',
    }),
  );
  expect(text).toContain('No measurement to show.');
  expect(text).toContain('The API answered 404 to the request for the report.');
  expect(text.replace('404', '')).not.toMatch(/\d/);
});

// ───── читання відповіді API ─────

test('🔴 відповідь, яку не можна прочитати, — не звіт', () => {
  expect(readDataQuality(report())).not.toBeNull();
  const bad = (change: (r: Record<string, unknown>) => void) => {
    const r = JSON.parse(JSON.stringify(report())) as Record<string, unknown>;
    change(r);
    return readDataQuality(r);
  };
  const line = (r: Record<string, unknown>) =>
    (r.lines as Record<string, unknown>[])[0];
  expect(readDataQuality(null)).toBeNull();
  expect(readDataQuality([])).toBeNull();
  expect(readDataQuality({ spots: 0 })).toBeNull();
  // число рядком — так bigint приїхав би без розбору на боці API
  expect(bad((r) => { line(r).n = '52645'; })).toBeNull();
  expect(bad((r) => { line(r).of = -1; })).toBeNull();
  expect(bad((r) => { line(r).of = 1.5; })).toBeNull();
  expect(bad((r) => { delete line(r).sql; })).toBeNull();
  expect(bad((r) => { line(r).sql = ''; })).toBeNull();
  expect(bad((r) => { line(r).label = 7; })).toBeNull();
  expect(bad((r) => { delete r.measuredAt; })).toBeNull();
  expect(bad((r) => { r.measuredAt = 'yesterday'; })).toBeNull();
  expect(bad((r) => { delete r.failures; })).toBeNull();
  expect(bad((r) => { (r.failures as Record<string, unknown>[])[0].error = undefined; })).toBeNull();
  // рядок у розділі, якого звіт не оголосив, сторінка мовчки б не показала
  expect(bad((r) => { line(r).group = 'unheard-of'; })).toBeNull();
});

const withFetch = async <T,>(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> => {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => impl(String(url), init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
};

test('звіт просять у /ops/data-quality, без кешу, і отримують його цілим', async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const answer = await withFetch(
    async (url, init) => {
      seen.push({ url, init });
      return Response.json(report());
    },
    getDataQuality,
  );
  expect(answer.report).toEqual(report());
  expect(seen).toHaveLength(1);
  expect(new URL(seen[0].url).pathname).toBe('/ops/data-quality');
  expect(seen[0].init?.cache).toBe('no-store');
});

test('🔴 збій API — це причина словами, ніколи не порожній звіт', async () => {
  const refused = await withFetch(async () => new Response('', { status: 404 }), getDataQuality);
  expect(refused.report).toBeUndefined();
  expect(refused.why).toBe('The API answered 404 to the request for the report.');

  const down = await withFetch(async () => {
    throw new Error('ECONNREFUSED');
  }, getDataQuality);
  expect(down.report).toBeUndefined();
  expect(down.why).toBe('The API did not answer.');

  const garbage = await withFetch(async () => new Response('<html>', { status: 200 }), getDataQuality);
  expect(garbage.why).toBe('The API answered with something that is not JSON.');

  const zeros = await withFetch(async () => Response.json({ spots: 0, countries: 0 }), getDataQuality);
  expect(zeros.report).toBeUndefined();
  expect(zeros.why).toBe('The API answered with a report this page cannot read.');
});

// ───── сама сторінка ─────

test('🔴 сторінка з живим звітом несе його числа й запити; зі збоєм — причину й жодного числа', async () => {
  const good = await withFetch(
    async () => Response.json(report()),
    () => renderAsyncComponent(DataQualityPage, {}),
  );
  const text = visibleText(good);
  expect(text).toContain('Data quality');
  expect(text).toContain('52,645');
  expect(text).toContain(SQL_A);

  const bad = await withFetch(
    async () => new Response('', { status: 500 }),
    () => renderAsyncComponent(DataQualityPage, {}),
  );
  const badText = visibleText(bad);
  expect(badText).toContain('No measurement to show.');
  expect(badText).toContain('The API answered 500');
  expect(badText).not.toContain('52,645');
  expect(bad).not.toContain('data-part="line"');
});

test('🔴 сторінка внутрішня: noindex від себе, закрита в robots.txt, поза картою сайту', () => {
  const robots = metadata.robots as { index?: boolean; follow?: boolean };
  expect(robots.index).toBe(false);
  expect(robots.follow).toBe(false);

  const rules = robotsFor(true).rules;
  const groups = (Array.isArray(rules) ? rules : [rules]) as { disallow?: unknown }[];
  expect(groups.length).toBeGreaterThan(0);
  for (const g of groups) {
    const closed = [g.disallow ?? []].flat().map(String);
    expect(closed.some((p) => '/internal/data-quality'.startsWith(p))).toBe(true);
  }

  expect(STATIC_HUBS.length).toBeGreaterThan(0);
  expect(STATIC_HUBS.filter((u) => u.loc.includes('/internal'))).toEqual([]);
});

test('🔴 сторінка малюється на запит, а не запікає числа у збірку', () => {
  expect(dynamic).toBe('force-dynamic');
});
