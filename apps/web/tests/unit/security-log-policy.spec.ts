import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import Privacy from '@/content/legal/privacy';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-353 — строк зберігання безпекового журналу живе у ДВОХ місцях:
 * у конфігу ротації на машині й у політиці приватності, яку читають
 * люди. Розбіжність між ними — не неточність, а опублікована неправда.
 *
 * 🔴 ЦЕЙ ТЕСТ ІСНУЄ, БО ТАКЕ ВЖЕ СТАЛОСЬ. До 19.10.2026 політика
 * стверджувала, що журналювання вимкнене. Це було виміряно й правдиво
 * 15.10 — і перестало бути правдою, коли на машині змінився ОДИН рядок
 * конфігу. Жодного рядка коду не торкнулись, жоден тест не почервонів.
 *
 * 🔴 ЧИТАЄТЬСЯ САМЕ ВІДРЕНДЕРЕНИЙ ТЕКСТ, А НЕ ФАЙЛ. Коментарі у
 * `privacy.tsx` пояснюють цей самий механізм і містять і «fourteen
 * days», і «rotate 13». Пошук по сирому файлу задовольнявся б
 * поясненням, а не обіцянкою — тобто перевіряв би сам себе. З тієї ж
 * причини з конфігу logrotate знімаються рядки `#`: у них теж є слово
 * `rotate`.
 */

// `__dirname`, а не `import.meta`: Playwright компілює ці специфікації
// в CommonJS (та сама причина, що й у csp.spec.ts).
const ROOT = path.join(__dirname, '..', '..', '..', '..');

/** Рядки конфігу без коментарів і порожніх. */
function directives(file: string): string[] {
  return readFileSync(path.join(ROOT, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

const rotateConf = directives('infra/logrotate/camptribe-caddy');
const caddyfile = directives('infra/caddy/camptribe.eu.caddyfile');

/**
 * Розібраний конфіг logrotate: окремо директиви, окремо тіла скриптів.
 *
 * 🔴 БЕЗ ЦЬОГО РОЗБОРУ ТЕСТ ОХОРОНЯВ ТРИ РЯДКИ З ШЕСТИ. Рецензія
 * 19.10.2026 прогнала мутації й показала, що при «5 passed» виживають:
 * `minsize 10M` (саме той розмірний гейт, заради вбивства якого картка
 * існує), `weekly` після `daily` (останнє виграє → 13 тижнів),
 * `maxsize 1k` (десятки ротацій на добу → строк КОРОТШИЙ за обіцяний),
 * зняття `copytruncate` і зняття всієї пари `chattr`.
 *
 * Причина була в формі перевірки: «містить `daily`» і «не містить
 * `notifempty`» — це список заборонених слів, а його обходять новим
 * словом. Тому нижче звіряється ПОВНА МНОЖИНА директив: будь-яка зайва
 * червоніє так само, як будь-яка зниклa.
 */
function parseRotate(lines: string[]) {
  const names: string[] = [];
  const value: Record<string, number> = {};
  const script: Record<string, string[]> = { prerotate: [], postrotate: [] };
  let inside: string | null = null;
  for (const line of lines) {
    if (line.endsWith('{') || line === '}') continue;
    if (line === 'prerotate' || line === 'postrotate') {
      inside = line;
      continue;
    }
    if (line === 'endscript') {
      inside = null;
      continue;
    }
    if (inside) {
      script[inside].push(line);
      continue;
    }
    const [name, arg] = line.split(/\s+/, 2);
    names.push(name);
    if (arg !== undefined && /^\d+$/.test(arg)) value[name] = Number(arg);
  }
  return { names, value, script };
}

const lr = parseRotate(rotateConf);

/** Шлях, який ротує logrotate — із заголовка блоку. */
const rotatedPath = rotateConf.find((l) => l.endsWith('{'))?.replace(/\s*\{$/, '') ?? '';

/** Шлях, у який пише Caddy — із директиви `output file`. */
const loggedPath = caddyfile.find((l) => l.startsWith('output file '))?.split(/\s+/)[2] ?? '';

/**
 * Скільки діб тримається рядок. Відротованих файлів `rotate N`, плюс
 * активний, який теж живе добу, бо ротація щоденна.
 */
const rotate = Number(rotateConf.find((l) => /^rotate\s+\d+$/.test(l))?.split(/\s+/)[1]);
const DAYS = rotate + 1;

/**
 * Число словами — рівно так, як воно стоїть у тексті політики.
 * Перелік навмисно короткий: якщо строк змінять на той, якого тут
 * немає, тест упаде з проханням дописати слово, а не промовчить.
 */
const WORD: Record<number, string> = { 7: 'seven', 14: 'fourteen', 28: 'twenty-eight', 30: 'thirty' };

const prose = visibleText(renderComponent(Privacy, {}));

/**
 * Текст ОДНОГО розділу, від заголовка до наступного.
 *
 * 🔴 БЕЗ ЦЬОГО ТЕСТ ПІДТВЕРДЖУВАВ САМ СЕБЕ, І МУТАЦІЙНИЙ ПРОГІН ЦЕ
 * ПОКАЗАВ. `rotate 13` → `rotate 29` означає строк 30 діб; перевірка
 * шукала «thirty days» по всьому документу — і знаходила, бо політика
 * каже «Sessions: thirty days» зовсім про інше. Мутація вижила, а
 * виглядала спійманою разом з усіма.
 */
function section(from: string, to: string): string {
  const a = prose.indexOf(from);
  const b = prose.indexOf(to, a + from.length);
  expect(a, `у політиці немає розділу «${from}»`).toBeGreaterThanOrEqual(0);
  expect(b, `після «${from}» немає «${to}» — розділ не обмежений`).toBeGreaterThan(a);
  return prose.slice(a, b);
}

const LOG = section('The security log', 'Your account, if you make one');

test('конфіг ротації розібрався, а не дав NaN', () => {
  expect(Number.isInteger(rotate), 'директиви `rotate N` у конфігу немає').toBe(true);
  expect(rotate).toBeGreaterThan(0);
  // 🔴 Пара до кожного твердження нижче: якщо рендер порожній, усі
  // `toContain` справдились би над порожнечею.
  expect(prose.length, 'політика відрендерилась порожньою').toBeGreaterThan(2000);
  expect(prose).toContain('Who is responsible');
});

test('набір директив рівно той, що дає календарний строк', () => {
  // 🔴 РІВНІСТЬ МНОЖИН, А НЕ «МІСТИТЬ». Додати `minsize`, `maxsize`,
  // `weekly` чи `notifempty` — кожне з них ламає строк по-своєму, і
  // жодне не ловиться переліком заборонених слів.
  expect([...lr.names].sort(), 'набір директив у конфігу ротації змінився').toEqual(
    ['compress', 'copytruncate', 'daily', 'maxage', 'missingok', 'rotate'].sort(),
  );
});

test('два замки строку: файли і дні', () => {
  // `rotate` рахує ФАЙЛИ. 13 відротованих + активний = 14 діб.
  expect(lr.value.rotate, '`rotate N` без числа').toBe(DAYS - 1);
  // `maxage` рахує ДНІ, і це інший замок: `daily` означає «не частіше
  // ніж раз на добу», а не «щонайменше раз». Простій таймера склав би
  // кілька діб в одну `.1`, яка потім жила б ще 13 ротацій.
  expect(lr.value.maxage, '`maxage` має дорівнювати обіцяному строку').toBe(DAYS);
});

test('пара chattr на місці, і її провал не мовчить', () => {
  const pre = lr.script.prerotate.join('\n');
  const post = lr.script.postrotate.join('\n');
  expect(pre, '`prerotate` має знімати append-only').toContain(`chattr -a ${rotatedPath}`);
  expect(post, '`postrotate` має повертати append-only').toContain(`chattr +a ${rotatedPath}`);
  // 🔴 ГОЛОВНЕ ТУТ — ДРУГИЙ РЯДОК `postrotate`. Поставити атрибут і
  // перевірити, що він став, — різні твердження; журнал без `+a`
  // зломщик перепише, і дізнатись про це з тиші неможливо.
  expect(post, '`postrotate` має ПЕРЕВІРЯТИ атрибут, а не лише ставити').toContain('lsattr');
  expect(post, 'перевірка має валити прогін').toContain('exit 1');
  // `|| true` робило б обидва провали тихими за побудовою.
  expect(pre + post, '`|| true` ковтає провал chattr').not.toContain('|| true');
});

test('веб-сервер не ротує сам, інакше господарів строку двоє', () => {
  expect(caddyfile, 'без `roll_disabled` рольщик Caddy сперечається з logrotate').toContain(
    'roll_disabled',
  );
  expect(
    caddyfile.some((l) => l.startsWith('roll_keep_for') || l.startsWith('roll_size')),
    'розмірна ротація повернулась — вона не дає календарного строку',
  ).toBe(false);
});

test('обидва конфіги говорять про ОДИН файл', () => {
  // 🔴 НАЙДОРОЖЧА ЗНАХІДКА РЕЦЕНЗІЇ. Усі перевірки строку зеленіли,
  // поки Caddy писав би в `web.log`, а logrotate ротував `access.log`:
  // ротується файл, у який ніхто не пише, а справжній журнал росте
  // вічно. Теза «строк живе у двох місцях» нічого не варта, якщо ці
  // два місця вказують у різні боки.
  expect(loggedPath, 'у Caddyfile немає `output file <шлях>`').toBeTruthy();
  expect(rotatedPath, 'у конфігу logrotate немає заголовка блоку').toBeTruthy();
  expect(loggedPath, 'Caddy пише не в той файл, який ротують').toBe(rotatedPath);
});

test('строк у політиці — той самий, що в конфігу', () => {
  const word = WORD[DAYS];
  expect(word, `строк став ${DAYS} діб — допиши це число словом у WORD`).toBeTruthy();
  expect(LOG, `розділ про журнал має називати строк «${word} days»`).toContain(`${word} days`);
  // Пара: жодне ІНШЕ число з переліку не має стояти в цьому ж розділі,
  // інакше «містить потрібне слово» нічого не означає.
  for (const [n, w] of Object.entries(WORD)) {
    if (Number(n) === DAYS) continue;
    expect(LOG, `у розділі про журнал стоїть і «${w} days»`).not.toContain(`${w} days`);
  }
});

test('політика не стверджує того, що скасовано', () => {
  expect(prose, 'текст досі каже, що журналювання вимкнене').not.toContain('switched off');
  expect(prose).toContain('The security log');
  expect(LOG, 'підстава має бути названа в самому розділі').toContain('Article 6(1)(f)');
  expect(LOG, 'право заперечити має бути назване').toContain('Article 21');
  expect(LOG, 'має бути сказано, що це не аналітика').toContain('Not used for:');
  expect(LOG, 'має бути сказано, що куки й авторизація не пишуться').toContain('REDACTED');
});

// ---------------------------------------------------------------------
// Перелік полів у політиці проти того, що сервер СПРАВДІ пише.
// ---------------------------------------------------------------------

/**
 * 🔴 ДО 19.10.2026 ПЕРЕЛІК ПОЛІВ СТОЯВ НА МОЄМУ СЛОВІ. Рецензія сказала
 * це прямо: у PR не було ні зразка рядка, ні директиви `format`, тож
 * перевірити опубліковане твердження не було чим.
 *
 * Поруч лежить `fixtures/caddy-access-line.json` — справжній рядок із
 * продакшн-журналу, знятий запитом із заголовками `Cookie` і
 * `Authorization`, щоб редагування було видно. Знеособлено: адреси
 * замінені на діапазони з RFC 5737 (вони не належать нікому), шлях і
 * код країни — нейтральні, трасувальний ідентифікатор обнулений.
 *
 * 🔴 ТАБЛИЦЯ ЗАКРИВАЄ МНОЖИНУ, А НЕ ПЕРЕЛІЧУЄ ВІДОМЕ. Кожне поле
 * зразка мусить бути тут названим: або з фразою, яка має стояти в
 * політиці, або явним `null` — «це про зʼєднання, не про читача». Нове
 * поле після оновлення Caddy червонить тест і змушує вирішити, чи
 * треба про нього сказати, замість того щоб зʼявитись мовчки.
 */
const FIELD: Record<string, string | null> = {
  ts: 'the time, to the second',
  'request.client_ip': 'IP address',
  'request.headers.Cf-Connecting-Ip': 'IP address',
  'request.headers.X-Forwarded-For': 'IP address',
  'request.headers.Cf-Ipcountry': 'country code',
  'request.headers.User-Agent': 'user-agent',
  'request.uri': 'the address of the page',
  'request.method': 'the method',
  status: 'the status',
  size: 'how many bytes',
  duration: 'how long',
  'request.tls.version': 'TLS version',
  'request.tls.cipher_suite': 'cipher',
  'request.headers.Cookie': 'REDACTED',
  'request.headers.Authorization': 'REDACTED',

  // Нижче — не про читача. Кожен рядок має причину, а не просто стоїть.
  level: null,
  logger: null,
  msg: null,
  // Адреса Cloudflare, не читача: справжня приходить у Cf-Connecting-Ip.
  'request.remote_ip': null,
  'request.remote_port': null,
  'request.proto': null,
  'request.host': null,
  'request.tls.resumed': null,
  'request.tls.proto': null,
  'request.tls.server_name': null,
  'request.tls.ech': null,
  'request.headers.Accept': null,
  'request.headers.Accept-Encoding': null,
  'request.headers.Cf-Visitor': null,
  'request.headers.Cdn-Loop': null,
  'request.headers.X-Forwarded-Proto': null,
  // Трасувальний ідентифікатор Cloudflare всередині їхньої мережі.
  'request.headers.Cf-Ray': null,
  bytes_read: null,
  user_id: null,
  'resp_headers.X-Robots-Tag': null,
  'resp_headers.Www-Authenticate': null,
  'resp_headers.Server': null,
  'resp_headers.Alt-Svc': null,
};

/** Усі шляхи до листків зразка, у тому вигляді, що й ключі `FIELD`. */
function leafPaths(o: unknown, prefix = ''): string[] {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    leafPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

const sample = JSON.parse(
  readFileSync(path.join(ROOT, 'apps/web/tests/unit/fixtures/caddy-access-line.json'), 'utf8'),
);
const samplePaths = leafPaths(sample);

test('зразок журналу знеособлений і не порожній', () => {
  const raw = JSON.stringify(sample);
  expect(samplePaths.length, 'зразок розібрався порожнім').toBeGreaterThan(20);
  // Пара: якби знеособлення колись забули, тест має сказати це тут, а
  // не дати справжній адресі лежати в публічному репозиторії.
  expect(raw, 'у зразку справжня адреса читача').not.toMatch(/"(?:94|159)\.\d+\.\d+\.\d+"/);
  expect(sample.request.headers.Cookie, 'куки мали б бути приховані').toEqual(['REDACTED']);
  expect(sample.request.headers.Authorization).toEqual(['REDACTED']);
});

test('кожне поле журналу названо — або в політиці, або як не-про-читача', () => {
  const unaccounted = samplePaths.filter((p) => !(p in FIELD));
  expect(unaccounted, 'у журналі зʼявились поля, про які політика мовчить').toEqual([]);
  // Зворотний бік: таблиця не має описувати полів, яких у журналі немає,
  // інакше вона поступово стає переліком побажань.
  const phantom = Object.keys(FIELD).filter((k) => !samplePaths.includes(k));
  expect(phantom, 'у таблиці поля, яких у зразку немає').toEqual([]);
});

test('кожне поле про читача справді описане в розділі', () => {
  const missing = Object.entries(FIELD)
    .filter(([, phrase]) => phrase !== null)
    .filter(([, phrase]) => !LOG.includes(phrase as string))
    .map(([field, phrase]) => `${field} → «${phrase}»`);
  expect(missing, 'поле пишеться, а політика про нього не каже').toEqual([]);
  expect(LOG, 'про решту рядка теж має бути сказано').toContain(
    'about the connection rather than about you',
  );
});

// ---------------------------------------------------------------------
// Що потрапляє в адресу сторінки — а звідти в той самий журнал.
// ---------------------------------------------------------------------

/**
 * 🔴 ТУТ БУЛА ОПУБЛІКОВАНА НЕПРАВДА, І ЗНАЙШЛА ЇЇ РЕЦЕНЗІЯ, А НЕ Я.
 * Політика стверджувала: «Our own pages carry nothing about you in the
 * address itself — no search terms, no identifiers». Насправді адресу
 * переписують ЧОТИРИ компоненти, і в неї лягає не лише пошуковий
 * запит, а й склад групи, діти, собака, кількість ночей і фільтри мапи.
 *
 * Мій власний греп цього не побачив, бо шукав `searchParams` — тобто
 * сторону ЧИТАННЯ. Пишуть же через шаблонний рядок і `replaceState`.
 *
 * Перелік закріплений навмисно: пʼятий такий компонент має почервонити
 * тест і змусити перечитати абзац, а не тихо розширити те, що ми про
 * себе розповіли.
 */
const URL_WRITERS = [
  'components/campsite-map.tsx',
  'components/packing-list-builder.tsx',
  'components/site-search.tsx',
  'components/trip-cost-calculator.tsx',
];

/** Файл без коментарів — сторож мусить читати КОД, а не пояснення. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const SRC = path.join(ROOT, 'apps/web/src');
const writers = walk(SRC)
  .filter((f) => /\breplaceState\s*\(|\bpushState\s*\(/.test(codeOnly(readFileSync(f, 'utf8'))))
  .map((f) => path.relative(SRC, f))
  .sort();

test('перелік компонентів, що пишуть в адресу, не змінився', () => {
  expect(writers.length, 'жодного файла не знайдено — сканер зламався').toBeGreaterThan(0);
  expect(writers, 'зʼявився новий запис в адресу — перечитай абзац у політиці').toEqual(
    URL_WRITERS,
  );
});

test('політика визнає, що адреса потрапляє в журнал', () => {
  // Двобічно: якщо такі компоненти є — абзац обовʼязковий; якщо колись
  // не стане жодного, обіцянка має зникнути разом із ними, інакше ми
  // лякаємо людей тим, чого не робимо.
  if (writers.length > 0) {
    expect(LOG, 'адреса потрапляє в журнал, а політика про це мовчить').toContain(
      'keep their state in the page address',
    );
    expect(LOG, 'має бути сказано, що в браузері нічого не надсилається').toContain(
      'they run in your browser',
    );
  } else {
    expect(LOG).not.toContain('keep their state in the page address');
  }
});

test('строк названо однаково в обох місцях, де він стоїть', () => {
  // 🔴 Друге «fourteen days» лежить у «Serving the pages», ПОЗА `LOG`,
  // і рецензія показала, що його можна було замінити на «thirty days»
  // при зелених тестах — політика суперечила б собі через абзац.
  const serving = section('Serving the pages', 'The security log');
  const word = WORD[DAYS] as string;
  expect(serving, `«Serving the pages» має називати той самий строк`).toContain(`${word} days`);
  for (const [n, w] of Object.entries(WORD)) {
    if (Number(n) === DAYS) continue;
    expect(serving, `у «Serving the pages» стоїть і «${w} days»`).not.toContain(`${w} days`);
  }
});
