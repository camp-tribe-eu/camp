import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DailyDedup } from './dedup';
import {
  AMENITY_KEYS,
  BROWSER_EVENTS,
  SPOT_EVENTS,
  canonicalFilters,
  classifyReferrer,
  isBot,
  parseSlug,
} from './events.rules';

const OWN = ['camptribe.eu'];

describe('боти', () => {
  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.1)',
    'Mozilla/5.0 (compatible; ClaudeBot/1.0)',
    'Mozilla/5.0 (compatible; PerplexityBot/1.0)',
    'HeadlessChrome/120.0',
    'curl/8.4.0',
    'python-requests/2.31',
    '',
  ])('%s — бот', (ua) => expect(isBot(ua)).toBe(true));

  it('порожнього й відсутнього UA — бот', () => {
    expect(isBot(undefined)).toBe(true);
    expect(isBot(null)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  ])('людський браузер не бот: %s', (ua) => expect(isBot(ua)).toBe(false));
});

describe('клас джерела', () => {
  it.each([
    ['https://www.google.com/search?q=x', 'organic'],
    ['https://www.google.de/', 'organic'],
    ['https://duckduckgo.com/', 'organic'],
    ['https://www.bing.com/search?q=a', 'organic'],
    ['https://chatgpt.com/', 'ai'],
    ['https://www.perplexity.ai/search/abc', 'ai'],
    ['https://claude.ai/chat/1', 'ai'],
    ['https://gemini.google.com/app', 'ai'],
    ['https://copilot.microsoft.com/', 'ai'],
    ['', 'direct'],
    [undefined, 'direct'],
    ['https://camptribe.eu/camping/hr', 'direct'],
    ['https://www.camptribe.eu/', 'direct'],
    ['https://notgoogle.example/', 'other'],
    ['https://google.evil.example/', 'other'],
    ['https://some-blog.example/post', 'other'],
    ['android-app://com.google.android.gm', 'other'],
    ['not a url at all %%', 'other'],
  ])('%s → %s', (ref, want) => {
    expect(classifyReferrer(ref, OWN)).toBe(want);
  });
});

describe('фільтри', () => {
  it('канонічний рядок не залежить від порядку', () => {
    expect(
      canonicalFilters(['overnight', 'amenity:wifi', 'type:paid', 'type:free']),
    ).toBe('type:free,paid|amenity:wifi|overnight');
    expect(canonicalFilters([])).toBe('');
  });
  it.each([
    [['Jane Doe']],
    [['amenity:']],
    [['type:nope']],
    ['x'],
    [[5]],
    [Array(17).fill('overnight')],
  ])('поза переліком → null: %j', (v) =>
    expect(canonicalFilters(v)).toBeNull(),
  );
  it('перелік зручностей збігається з вебом', () => {
    const web = readFileSync(
      join(__dirname, '..', '..', '..', 'web', 'src', 'lib', 'api.ts'),
      'utf8',
    );
    const block =
      /export const AMENITY_KEYS: AmenityKey\[\] = \[([\s\S]*?)\];/.exec(
        web,
      )![1];
    const keys = [...block.matchAll(/^\s*'(\w+)',/gm)].map((m) => m[1]);
    expect([...keys].sort()).toEqual([...AMENITY_KEYS].sort());
  });
});

describe('словники', () => {
  it('події в коді = події в CHECK міграції', () => {
    const sql = readFileSync(
      join(__dirname, '..', 'migrations', '1796700000000-EventRollups.ts'),
      'utf8',
    );
    const check = /event IN \(([^)]*)\)/.exec(sql)![1];
    const listed = [...check.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...SPOT_EVENTS]);
  });
  it('браузер не може надіслати серверні події', () => {
    expect(BROWSER_EVENTS).not.toContain('route_inclusion');
    expect(BROWSER_EVENTS).not.toContain('website_click');
  });
  it('slug-и: лише безпечні', () => {
    expect(parseSlug('camping-a1')).toBe('camping-a1');
    for (const bad of [
      '',
      '../x',
      'a b',
      'https://x',
      'A',
      "a'b",
      'a'.repeat(201),
      5,
      null,
    ])
      expect(parseSlug(bad)).toBeNull();
  });
});

describe('дедуплікація: лише памʼять', () => {
  const p = {
    ip: '192.0.2.4',
    userAgent: 'UA',
    object: 'o',
    event: 'e',
    day: '2026-11-12',
  };
  it('повтор — дубль; інший день, обʼєкт, подія, IP, UA — ні', () => {
    const d = new DailyDedup();
    expect(d.seen(p)).toBe(false);
    expect(d.seen(p)).toBe(true);
    for (const other of [
      { ...p, object: 'o2' },
      { ...p, event: 'e2' },
      { ...p, ip: '192.0.2.5' },
      { ...p, userAgent: 'UA2' },
    ])
      expect(d.seen(other)).toBe(false);
    expect(d.seen({ ...p, day: '2026-11-13' })).toBe(false);
    expect(d.seen(p)).toBe(false); // вчорашній день очищено
  });
  it('памʼять обмежена, але подію не губить', () => {
    const d = new DailyDedup(3);
    for (let i = 0; i < 10; i++)
      expect(d.seen({ ...p, object: `o${i}` })).toBe(false);
    expect(d.size()).toBe(3);
  });
  it('клас не має файлової системи, мережі й бази', () => {
    const src = readFileSync(join(__dirname, 'dedup.ts'), 'utf8');
    expect(src).not.toMatch(
      /from 'node:(fs|net|http|https|dgram)'|typeorm|\.query\(|writeFile|console\./,
    );
  });
});
