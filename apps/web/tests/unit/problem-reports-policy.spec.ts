import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';

import { legalPage } from '@/lib/legal';
import { requestReaders, walkImportGraph } from './import-graph';
import { seededHtml } from './legal-cms';
import { visibleText } from './rendered-text';

/**
 * Політика приватності 2.1 — розділ про форму «Report a problem».
 *
 * 🔴 ОДИН ФАКТ У ТРЬОХ МІСЦЯХ: строк зберігання заявок стоїть у коді
 * (`RULES` у `scripts/ops/retention-purge.mjs` — те, що база справді
 * робить), у реєстрі операцій (`docs/GDPR-REGISTER.md`, розділ 10 — те, що
 * покажуть наглядовому органу) і в політиці (те, що обіцяно читачеві).
 * Підстава — у двох останніх. Розбіжність між будь-якими двома — не
 * неточність, а опублікована неправда, тож тут одне джерело (код) звіряється
 * з двома документами, а не документи між собою.
 *
 * 🔴 ЧИТАЄТЬСЯ ВІДРЕНДЕРЕНИЙ ТЕКСТ, не розмітка й не константа: крізь той
 * самий `LegalProse`, що й сторінка, і береться ВИДИМЕ. Текст — із міграцій
 * (`legal-cms.ts`); правка в CMS цьому файлу невидима, що доведено й названо
 * там.
 */

// `__dirname`, а не `import.meta`: Playwright компілює специфікації в CommonJS.
const ROOT = resolve(__dirname, '..', '..', '..', '..');

type Branch = { name: string; months: number };
type Rule = { table: string; branches: Branch[] };

/** Правила строків — із самого сторожа, не переписані сюди. */
async function rules(): Promise<Rule> {
  const mod = (await import(
    pathToFileURL(join(ROOT, 'scripts', 'ops', 'retention-purge.mjs')).href
  )) as { RULES: Rule[] };
  const rule = mod.RULES.find((r) => r.table === 'problem_reports');
  if (!rule) throw new Error('retention-purge.mjs: немає правила для problem_reports');
  return rule;
}

/** Розділ 10 реєстру: рядки таблиці за назвою поля. */
function registerSection10(): Record<string, string> {
  const md = readFileSync(join(ROOT, 'docs', 'GDPR-REGISTER.md'), 'utf8');
  const start = md.indexOf('\n## 10. ');
  if (start < 0) throw new Error('GDPR-REGISTER.md: немає розділу 10');
  const rest = md.slice(start + 1);
  const end = rest.search(/\n(## |---)/);
  const section = end < 0 ? rest : rest.slice(0, end);
  const rows: Record<string, string> = {};
  for (const m of section.matchAll(/^\| \*\*([^*]+)\*\* \| (.*) \|$/gm)) {
    rows[m[1].trim()] = m[2];
  }
  if (!rows['підстава'] || !rows['строк']) {
    throw new Error(
      `GDPR-REGISTER.md розділ 10: немає рядків «підстава»/«строк»; є: ${Object.keys(rows).join(', ')}`,
    );
  }
  return rows;
}

/** Підрозділ {#reports} політики: від його `<h3>` до наступного заголовка. */
function reportsSectionHtml(): string {
  const html = seededHtml('privacy');
  const at = html.search(/<h3\b[^>]*\sid="reports"/);
  expect(at, 'у політиці немає заголовка з якорем «reports»').toBeGreaterThanOrEqual(0);
  const rest = html.slice(at);
  const next = rest.slice(1).search(/<h[23]\b/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test.describe('політика приватності описує форму «Report a problem»', () => {
  test('🔴 розділ є, і він каже, що зберігається і що ні', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toMatch(/^Reporting a problem with a campsite page/);
    expect(text).toContain('Report a problem');
    // Що збираємо — усе пʼять, і що контакт необовʼязковий.
    expect(text).toContain('which campsite it is about');
    expect(text).toContain('the kind of problem you chose from the list');
    expect(text).toContain('2 000 characters');
    expect(text).toContain('200 characters');
    expect(text).toContain('the moment the report arrived');
    expect(text).toContain('only if you typed one');
    expect(text).toContain('The contact is optional');
    // Що НЕ збираємо, і що зайве поле відхиляється, а не обрізається.
    expect(text).toMatch(/does not send, and the table has no column for, your IP address/);
    expect(text).toContain('user-agent string');
    expect(text).toContain('your location or any account');
    expect(text).toContain('is refused outright, not trimmed');
  });

  test('🔴 IP у лічильнику частоти та в журналі вебсервера названо, а не замовчано', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toContain('counts how many reports arrive from each IP address');
    expect(text).toContain('at most five in ten minutes');
    expect(text).toContain('in memory only');
    expect(text).toContain('never in the database');
    expect(text).toContain('one line in the security log');
    expect(text).toContain('not what you wrote');
  });

  test('🔴 попередження не вписувати персональних даних — своїх чи чужих', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toContain(
      'Please do not put personal details into the description — yours or anyone else’s.',
    );
    expect(text).toContain('we do not filter it');
  });

  test('🔴 підстава — ст. 6(1)(f), і сказано, чому не згода', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toContain('Legal basis:');
    expect(text).toContain('legitimate interest');
    expect(text).toContain('Article 6(1)(f) GDPR');
    expect(text).toContain('We do not ask for your consent');
  });

  test('🔴 права: доступ, виправлення, видалення, заперечення за ст. 21 — і адреса, куди писати', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toContain('object to this processing under Article 21 GDPR');
    expect(text).toContain('see, correct or delete a report you sent');
    // Адреса — літералом, не константою: перевіряється те, що читач побачить.
    expect(text).toContain('privacy@camptribe.eu');
    // І в розділі «Your rights» теж, бо саме туди читач іде по права.
    const html = seededHtml('privacy');
    const rights = html.slice(html.search(/<h2\b[^>]*\sid="rights"/));
    const rightsText = visibleText(rights.slice(0, rights.slice(1).search(/<h2\b/) + 1));
    expect(rightsText).toContain('privacy@camptribe.eu');
    expect(html).toContain('href="mailto:privacy@camptribe.eu"');
  });

  test('розділ «How long we keep it» теж називає заявки, і посилання між ними живі', () => {
    const html = seededHtml('privacy');
    const keep = html.slice(html.search(/<h2\b[^>]*\sid="keep"/));
    const keepText = visibleText(keep.slice(0, keep.slice(1).search(/<h2\b/) + 1));
    expect(keepText).toContain('Problem reports');
    expect(html).toContain('href="/legal/privacy#reports"');
    expect(html).toContain('href="/legal/privacy#keep"');
    expect(html).toMatch(/<h2\b[^>]*\sid="keep"/);
  });
});

test.describe('🔴 строк і підстава однакові в коді, реєстрі й політиці', () => {
  test('строки з RULES стоять дослівно у політиці — обидві гілки', async () => {
    const rule = await rules();
    // Пара: правило справді має дві гілки, інакше цикл нижче міряє порожнечу.
    expect(rule.branches.map((b) => b.name).sort()).toEqual(['closed', 'open']);
    const text = visibleText(seededHtml('privacy'));
    const keep = visibleText(reportsSectionHtml());
    for (const b of rule.branches) {
      expect(keep, `гілка «${b.name}»`).toContain(`${b.months} months`);
      // Число з коду зустрічається у політиці щонайменше двічі: розділ про
      // форму і «How long we keep it».
      expect(text.split(`${b.months} months`).length - 1, `«${b.months} months» у політиці`)
        .toBeGreaterThanOrEqual(2);
    }
    // І що жодного ТРЕТЬОГО числа місяців у розділі немає: «12 and 36» не пройде.
    const stated = [...keep.matchAll(/(\d+) months/g)].map((m) => Number(m[1]));
    expect(new Set(stated)).toEqual(new Set(rule.branches.map((b) => b.months)));
  });

  test('строки з RULES стоять у реєстрі (розділ 10), і він більше не каже «не вирішено»', async () => {
    const rule = await rules();
    const rows = registerSection10();
    for (const b of rule.branches) {
      expect(rows['строк'], `гілка «${b.name}»`).toMatch(
        new RegExp(`\\*\\*${b.months} місяц(і|ів)\\*\\*`),
      );
    }
    expect(rows['строк']).not.toMatch(/не вирішено/);
    expect(rows['строк']).toContain('retention-purge.mjs');
  });

  test('підстава в реєстрі й у політиці — одна: 6(1)(f)', () => {
    const rows = registerSection10();
    expect(rows['підстава']).toContain('6(1)(f)');
    expect(rows['підстава']).not.toMatch(/не вирішено/);
    expect(visibleText(reportsSectionHtml())).toContain('Article 6(1)(f)');
  });

  test('реєстр відсилає до того самого якоря політики, що існує', () => {
    const rows = registerSection10();
    const row = Object.values(rows).find((v) => v.includes('/legal/privacy#'));
    expect(row, 'у розділі 10 немає посилання на політику').toBeDefined();
    const anchor = /\/legal\/privacy#([a-z-]+)/.exec(row!)![1];
    expect(seededHtml('privacy')).toMatch(new RegExp(`<h[23]\\b[^>]*\\sid="${anchor}"`));
  });
});

test.describe('реєстр правових сторінок і сама сторінка', () => {
  test('версія політики піднята разом із текстом: 2.2 від 01.11.2026', () => {
    const p = legalPage('privacy')!;
    expect(p.version).toBe('2.2');
    expect(p.effectiveFrom).toBe('2026-11-01');
  });

  // 🔴 Політика лишається статичною: ні сторінка, ні будь-що, що вона
  // імпортує, не читає запиту. Та сама прогулянка графом імпортів, що й у
  // `report-problem.spec.tsx` для сторінки кемпінгу.
  test('🔴 сторінка /legal/[slug] і все, що вона імпортує, не читають запиту', () => {
    const SRC = resolve(__dirname, '..', '..', 'src');
    const page = join(SRC, 'app', 'legal', '[slug]', 'page.tsx');
    const seen = walkImportGraph(SRC, [page]);
    const names = [...seen].map((f) => f.slice(SRC.length + 1));
    expect(names).toContain('lib/legal-content.ts');
    expect(names).toContain('components/legal-prose.tsx');
    expect(seen.size).toBeGreaterThan(5);
    const offenders = requestReaders(SRC, seen);
    if (/\bsearchParams\b/.test(readFileSync(page, 'utf8'))) {
      offenders.push('page.tsx: searchParams in a page');
    }
    expect(offenders).toEqual([]);
    expect(readFileSync(page, 'utf8')).toContain('export const dynamicParams = false');
  });
});

// ---------------------------------------------------------------------------
// 🔴 ОБРОБНИКИ Й ОТРИМУВАЧІ: РЕЄСТР = ПОЛІТИКА = КОД (борг №27).
//
// До 01.11.2026 реєстр називав Resend поштовим сервісом, а код слав через
// SMTP Hetzner уже два тижні; політика казала «Three processors» і
// перелічувала двох. Жоден тест цього не бачив, бо жоден не читав усі три
// місця разом. Тут вони читаються разом, і «реально в коді» означає:
//
//   · пошта — набір значень MAIL_PROVIDER, які `apps/api/src/auth/mail.ts`
//     справді приймає, і хост SMTP у `apps/api/.env.example` (Hetzner —
//     `*.your-server.de`);
//   · край — заголовок `CF-Connecting-IP`, який читають Caddy й `throttle.ts`;
//   · прямі зʼєднання браузера — хости, що стоять ЛІТЕРАЛАМИ в коді й CSP:
//     `lib/map-sources.ts` (плитки), `lib/webcams.ts` і `img-src`
//     (вебкамери), `data/satellite-sources.json` (супутник).
//
// ⚠️ Чого це не бачить, названо в реєстрі: значення env на самій машині
// (`SMTP_HOST`, `NEXT_PUBLIC_SELF_TILES_URL`) репозиторій не несе.
// ---------------------------------------------------------------------------

type Party = { name: string; role: 'processor' | 'direct' | 'none'; hosts: string[] };

/** Таблиця «Обробники й отримувачі» реєстру: імʼя, роль і хости в коді. */
function registerParties(): Party[] {
  const md = readFileSync(join(ROOT, 'docs', 'GDPR-REGISTER.md'), 'utf8');
  const start = md.indexOf('\n## Обробники');
  if (start < 0) throw new Error('GDPR-REGISTER.md: немає розділу «Обробники»');
  const rest = md.slice(start + 1);
  const end = rest.slice(1).search(/\n## /);
  const section = end < 0 ? rest : rest.slice(0, end + 1);
  const out: Party[] = [];
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // | хто | роль | що робить | де | хости | доказ |  → 8 комірок із порожніми краями
    if (cells.length !== 8 || cells[1] === 'хто' || /^-+$/.test(cells[1])) continue;
    const role = cells[2];
    if (role !== 'processor' && role !== 'direct' && role !== 'none') {
      throw new Error(`реєстр: у «${cells[1]}» роль «${role}» — не processor/direct/none`);
    }
    const hosts = [...cells[5].matchAll(/`([a-z0-9.-]+\.[a-z]{2,}(?::\d+)?)`/g)].map((m) => m[1]);
    out.push({ name: cells[1], role, hosts });
  }
  if (out.length === 0) throw new Error('реєстр: таблиця обробників порожня або іншої форми');
  return out;
}

/** Розділ «Who else sees it» політики: два списки жирних імен — обробники й прямі. */
function policyParties(): { processors: string[]; direct: string[] } {
  const html = seededHtml('privacy');
  const at = html.search(/<h2\b[^>]*\sid="who-else"/);
  expect(at, 'у політиці немає розділу «Who else sees it»').toBeGreaterThanOrEqual(0);
  const rest = html.slice(at);
  const next = rest.slice(1).search(/<h2\b/);
  const section = next < 0 ? rest : rest.slice(0, next + 1);
  const lists = [...section.matchAll(/<ul\b[^>]*>([\s\S]*?)<\/ul>/g)].map((m) => m[1]);
  expect(lists.length, 'у розділі мають бути рівно два списки: обробники й прямі зʼєднання').toBe(2);
  const names = (ul: string) =>
    [...ul.matchAll(/<li\b[^>]*>[\s\S]*?<strong\b[^>]*>([\s\S]*?)<\/strong>/g)].map((m) =>
      visibleText(m[1]),
    );
  return { processors: names(lists[0]), direct: names(lists[1]) };
}

/** Хости, до яких браузер читача зʼєднується сам, — літерали в коді й CSP. */
function hostsInCode(): Array<{ host: string; where: string }> {
  const web = join(ROOT, 'apps', 'web');
  const out: Array<{ host: string; where: string }> = [];
  const pick = (file: string, re: RegExp) => {
    const text = readFileSync(join(web, file), 'utf8');
    for (const m of text.matchAll(re)) out.push({ host: new URL(m[1]).host, where: file });
  };
  // Плитки: типове значення, коли NEXT_PUBLIC_TILES_URL не задано.
  pick('src/lib/map-sources.ts', /NEXT_PUBLIC_TILES_URL \?\? '(https:\/\/[^']+)'/g);
  // Вебкамери: адреса кадру.
  pick('src/lib/webcams.ts', /`(https:\/\/[^/`]+)\//g);
  // CSP img-src: усе, що не 'self'/data:/blob:.
  pick('scripts/security-headers.mjs', /"img-src [^"]*?(https:\/\/[^\s"]+)/g);
  // Супутник: кожне джерело.
  const sat = JSON.parse(readFileSync(join(web, 'src', 'data', 'satellite-sources.json'), 'utf8')) as {
    sources: Array<{ id: string; tiles: string }>;
  };
  for (const s of sat.sources) out.push({ host: new URL(s.tiles).host, where: `satellite-sources.json ${s.id}` });
  if (out.length < 4) throw new Error(`хостів у коді знайдено ${out.length} — розбір зламався`);
  return out;
}

const diff = (a: string[], b: string[]) => ({
  onlyA: a.filter((x) => !b.includes(x)),
  onlyB: b.filter((x) => !a.includes(x)),
});

test.describe('🔴 обробники й отримувачі: реєстр = політика = код', () => {
  test('обробники (ст. 28): ті самі імена в реєстрі й у політиці, і жодного зайвого', () => {
    const reg = registerParties().filter((p) => p.role === 'processor').map((p) => p.name);
    const pol = policyParties().processors;
    const d = diff(reg, pol);
    expect(
      [...d.onlyA.map((n) => `лише в реєстрі: ${n}`), ...d.onlyB.map((n) => `лише в політиці: ${n}`)],
      'обробники розійшлись',
    ).toEqual([]);
    expect(reg.length).toBeGreaterThanOrEqual(2);
    // Політика називає їхнє число словом — воно мусить дорівнювати переліку.
    const text = visibleText(seededHtml('privacy'));
    const word = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][reg.length];
    expect(text).toContain(`${word} processors`);
  });

  test('прямі зʼєднання браузера: ті самі імена в реєстрі й у політиці', () => {
    const reg = registerParties().filter((p) => p.role === 'direct').map((p) => p.name);
    const pol = policyParties().direct;
    const d = diff(reg, pol);
    expect(
      [...d.onlyA.map((n) => `лише в реєстрі: ${n}`), ...d.onlyB.map((n) => `лише в політиці: ${n}`)],
      'отримувачі за прямим зʼєднанням розійшлись',
    ).toEqual([]);
    const text = visibleText(seededHtml('privacy'));
    const word = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][reg.length];
    expect(text).toContain(`${word} services are not our processors`);
  });

  test('🔴 кожен хост, до якого браузер ходить за кодом, має свого отримувача в реєстрі — і навпаки', () => {
    const code = hostsInCode();
    const reg = registerParties().filter((p) => p.role === 'direct');
    const problems: string[] = [];
    for (const { host, where } of code) {
      const owners = reg.filter((p) => p.hosts.includes(host));
      if (owners.length !== 1) {
        problems.push(`хост ${host} (${where}) має ${owners.length} рядків у реєстрі, потрібен рівно один`);
      }
    }
    for (const p of reg) {
      if (p.hosts.length === 0) problems.push(`«${p.name}» у реєстрі без жодного хоста`);
      for (const h of p.hosts) {
        if (!code.some((c) => c.host === h)) {
          problems.push(`«${p.name}»: хост ${h} стоїть у реєстрі, але в коді його більше немає`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test('🔴 пошта: mail.ts приймає лише dev і smtp, а хост SMTP — Hetzner, якого реєстр і політика називають', () => {
    const mail = readFileSync(join(ROOT, 'apps', 'api', 'src', 'auth', 'mail.ts'), 'utf8');
    const accepted = [...mail.matchAll(/provider === '([a-z0-9]+)'/g)].map((m) => m[1]).sort();
    expect(accepted, 'mail.ts приймає провайдера, якого реєстр не знає').toEqual(['dev', 'smtp']);
    const env = readFileSync(join(ROOT, 'apps', 'api', '.env.example'), 'utf8');
    const smtpHost = /^SMTP_HOST=([^\s#]+)/m.exec(env)?.[1] ?? '';
    expect(smtpHost, '.env.example без SMTP_HOST').not.toBe('');
    const owner = registerParties().find((p) => p.hosts.includes(smtpHost));
    expect(owner?.name, `хост SMTP ${smtpHost} не належить жодному обробнику в реєстрі`).toBeTruthy();
    expect(owner!.role).toBe('processor');
    expect(policyParties().processors).toContain(owner!.name);
    // І сам відправник називає того ж обробника, що й реєстр: хост → імʼя.
    const sender = readFileSync(join(ROOT, 'apps', 'api', 'src', 'auth', 'mail-smtp.ts'), 'utf8');
    expect(sender, 'mail-smtp.ts не називає обробника з реєстру').toContain(owner!.name.split(' ')[0]);
  });

  test('🔴 край: CF-Connecting-IP читають Caddy й throttle.ts — отже Cloudflare обробник, і він названий', () => {
    const caddy = readFileSync(join(ROOT, 'infra', 'caddy', 'camptribe.eu.caddyfile'), 'utf8');
    const throttle = readFileSync(join(ROOT, 'apps', 'api', 'src', 'throttle.ts'), 'utf8');
    expect(caddy).toMatch(/CF-Connecting-IP/i);
    expect(throttle).toMatch(/cf-connecting-ip/i);
    const cf = registerParties().find((p) => /cloudflare/i.test(p.name));
    expect(cf?.role, 'Cloudflare у реєстрі має бути processor').toBe('processor');
    expect(policyParties().processors).toContain(cf!.name);
  });

  test('«The map»: не обіцяє перемикати провайдера — кнопки перемикають стилі', () => {
    const text = visibleText(seededHtml('privacy'));
    expect(text).not.toContain('you can switch it');
    expect(text).toContain('switch between its styles, not between providers');
    // І кнопки справді є, інакше речення про стилі — вигадка.
    const map = readFileSync(join(ROOT, 'apps', 'web', 'src', 'components', 'campsite-map.tsx'), 'utf8');
    expect(map).toContain('aria-label="Map style"');
  });

  test('«Changes»: не каже, що всі редакції лежать у git', () => {
    const text = visibleText(seededHtml('privacy'));
    expect(text).not.toContain('Earlier versions are in our public source repository');
    expect(text).toContain('The text itself is held in our database');
  });

  test('реєстр §4, §5, §9 мають свої розділи в політиці, і ті кажуть правду про строк', () => {
    const html = seededHtml('privacy');
    for (const anchor of ['browser-errors', 'dead-links', 'planner']) {
      expect(html, `немає якоря «${anchor}»`).toMatch(new RegExp(`<h3\\b[^>]*\\sid="${anchor}"`));
    }
    const text = visibleText(html);
    // Автоматичного видалення для цих двох журналів у коді немає (0 DELETE) — політика не обіцяє.
    expect(text).toContain('we have not yet built an automatic deletion for these reports');
    expect(text).toContain('there is no automatic deletion yet');
    // Планувальник: нічого не зберігається, ліміт 10/хв — із throttle.ts.
    const throttle = readFileSync(join(ROOT, 'apps', 'api', 'src', 'throttle.ts'), 'utf8');
    const plan = /export const PLAN_LIMIT = \{ ttl: ([^,]+), limit: (\d+) \}/.exec(throttle);
    expect(plan, 'PLAN_LIMIT не знайдено в throttle.ts').not.toBeNull();
    expect(Number(plan![2])).toBe(10);
    expect(text).toContain('ten times a minute');
  });
});
