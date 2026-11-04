import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';

// 🔴 API МУСИТЬ СТАРТУВАТИ ТАК, ЯК ЇЇ СТАРТУЄ ДЕПЛОЙ. ЦЬОГО НЕ ПЕРЕВІРЯВ НІХТО.
//
// Заміряно 04.11.2026: нічний деплой упав на тимчасовій збірковій API —
// `Unable to connect to the database. Retrying (1)…(10)`, вихід із кодом 1,
// реліз прибрано, прод лишився на старому. Код пройшов увесь CI зеленим.
//
// Деплой запускає API як `env PORT=3002 node dist/main` із `.env` У ТЕЦІ:
// `DATABASE_URL` потрапляє в процес лише тоді, коли хтось прочитає файл.
// Кожен запуск API в CI (`.github/actions/build-site`) має `DATABASE_URL`
// В ОТОЧЕННІ процесу — тож коли CAMP-433 винесла обчислення адреси в
// модульну область `db-session.ts`, яка імпортується раніше за будь-яке
// читання `.env`, CI цього не побачив: змінна була в оточенні ще до
// першого імпорту. Локально теж ні: типова адреса веде в `camptribe_dev`,
// яка на ноуті є, і API стартувала — лише не в ту базу.
//
// Цей спек повторює деплой, а не CI:
//   • збирає `dist` тим самим `npm run build` (застарілий `dist` перевіряв
//     би старий код — `nest-cli.json` стирає теку перед збіркою);
//   • запускає `node dist/main` із ПОРОЖНІМ оточенням (`PATH`, `HOME`,
//     `USER`, `PORT`) і `.env` у тимчасовій теці — як `as_user env PORT=… node`;
//   • чекає, доки API відповість по HTTP, — Nest слухає лише після того,
//     як TypeORM зʼєднався, тож відповідь означає зʼєднання;
//   • читає з `pg_stat_activity`, У ЯКІЙ БАЗІ опинився бекенд API.
//
// Останнє — щоб спек червонів і на ноуті, де `camptribe_dev` існує: там
// API стартує, і сама лише HTTP-відповідь його не ловить. Бекенд
// упізнається за `application_name`, який `pg` бере з `PGAPPNAME`
// (`pg/lib/connection-parameters.js`): змінна лежить у `.env`, і її
// читає вже `ConfigModule`, тож імʼя доходить незалежно від дефекту, а
// база — лише коли `.env` прочитано ДО обчислення `PG_CONNECTION`.
//
// Мутація, що червонить: прибрати `loadDotenv(...)` із `db-session.ts`
// (або перенести обчислення `url` назад перед читання `.env`). Заміряно:
// без неї бекенд сидить у `camptribe_dev`, а не в базі з `.env`.

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
const API_ROOT = join(__dirname, '..');
const DIST_MAIN = join(API_ROOT, 'dist', 'main.js');
const START_TIMEOUT_MS = 45_000;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('🔴 API стартує так, як її стартує деплой', () => {
  let api: ChildProcess | undefined;
  let cwd: string;
  let port: number;
  let appName: string;
  let output = '';

  beforeAll(async () => {
    if (!URL) {
      throw new Error('set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL)');
    }
    // Той самий крок, що в `build_api()` деплою. Завжди, бо `dist` із
    // учорашньої збірки довів би щось про вчорашній код.
    execFileSync('npm', ['run', 'build'], { cwd: API_ROOT, stdio: 'pipe' });
    if (!existsSync(DIST_MAIN)) {
      throw new Error(`збірка не дала ${DIST_MAIN}`);
    }

    port = await freePort();
    appName = `camp-startup-probe-${process.pid}-${Date.now()}`;
    cwd = mkdtempSync(join(tmpdir(), 'camp-startup-'));
    // `.env` як на машині: адреса бази ЛИШЕ тут, не в оточенні.
    writeFileSync(
      join(cwd, '.env'),
      [
        `DATABASE_URL=${URL}`,
        `PGAPPNAME=${appName}`,
        'MAIL_PROVIDER=dev',
        'WEB_BASE_URL=http://localhost:3000',
        '',
      ].join('\n'),
    );

    api = spawn(process.execPath, [DIST_MAIN], {
      cwd,
      // Рівно те, що лишає `sudo -u camptribe -H env PORT=… node` у
      // деплої: шлях, дім і ТОГО користувача. `USER` тут не дрібниця:
      // без адреси в оточенні `pg` бере типового користувача саме з
      // `process.env.USER`, і без нього API падає ще до бази — з іншої
      // причини, ніж та, яку цей спек ловить.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        USER: process.env.USER ?? '',
        LOGNAME: process.env.LOGNAME ?? process.env.USER ?? '',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    api.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    api.stderr?.on('data', (d: Buffer) => (output += d.toString()));
  }, START_TIMEOUT_MS + 60_000);

  afterAll(async () => {
    if (api && api.exitCode === null) {
      const gone = new Promise((r) => api?.once('exit', r));
      api.kill('SIGTERM');
      await gone;
    }
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  const tail = () =>
    output
      .replace(/\x1b\[[0-9;]*m/g, '')
      .split('\n')
      .filter(
        (l) =>
          l.trim() &&
          !/\[(InstanceLoader|RoutesResolver|RouterExplorer)\]/.test(l),
      )
      .slice(-12)
      .join('\n');

  it(
    'відповідає по HTTP, маючи DATABASE_URL лише в .env',
    async () => {
      const deadline = Date.now() + START_TIMEOUT_MS;
      let answered = false;
      while (Date.now() < deadline) {
        if (api?.exitCode !== null) {
          throw new Error(
            `API вийшла з кодом ${api?.exitCode} до того, як відповіла. Кінець виводу:\n${tail()}`,
          );
        }
        try {
          // Будь-яка відповідь: `/health` може віддати 503 на порожній
          // базі, але Nest слухає лише після зʼєднання TypeORM.
          await fetch(`http://127.0.0.1:${port}/health`);
          answered = true;
          break;
        } catch {
          await sleep(250);
        }
      }
      if (!answered) {
        throw new Error(
          `API не відповіла за ${START_TIMEOUT_MS} мс. Кінець виводу:\n${tail()}`,
        );
      }
    },
    START_TIMEOUT_MS + 5_000,
  );

  it('🔴 і її бекенд сидить у базі з .env, а не в типовій', async () => {
    const expectedDb = new globalThis.URL(URL as string).pathname.slice(1);
    const c = new Client({
      connectionString: URL,
      application_name: 'camp-startup-spec',
    });
    await c.connect();
    try {
      const r = await c.query<{ datname: string }>(
        'SELECT datname FROM pg_stat_activity WHERE application_name = $1',
        [appName],
      );
      // 🔴 Знаменник: нуль бекендів означає, що API не підписала
      // зʼєднання, і про базу тут нічого не доведено.
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.rows.map((x) => x.datname)).toEqual(
        r.rows.map(() => expectedDb),
      );
    } finally {
      await c.end();
    }
  });
});
