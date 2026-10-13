import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { collect, type CollectDeps } from './collect';
import {
  adopt,
  ageMinutes,
  FRESH_FOR_MINUTES,
  type Snapshot,
} from './snapshot';

/**
 * Як часто оновлювати знімок.
 *
 * 🔴 Пʼять хвилин при десятихвилинному бюджеті ліцензії, а не девʼять.
 * Один пропущений оберт тоді ще лишає знімок придатним, а два — вже ні,
 * і читач побачить `stale` замість протермінованого попередження.
 * Клаузула 5.6 MeteoAlarm: «on average less than five minutes and never
 * longer than ten minutes».
 */
export const REFRESH_EVERY_MS = 5 * 60_000;

/** Порожній знімок до першого оберту: часу немає, бо ми ще не питали. */
export const NOTHING_YET: Snapshot = { fetchedAt: null, warnings: [] };

type Fetcher = Pick<CollectDeps, 'countries' | 'feedUrl' | 'warningsFrom'>;

/**
 * 🔴 Фетчер ПЕРЕВИКОРИСТОВУЄТЬСЯ, не переписується.
 * `scripts/meteoalarm/fetch-warnings.mjs` уже знає про 27 країн, про те,
 * що таке протерміноване й що таке зелений рівень, і має 164 випадки
 * самотесту. Друга копія цих правил розійшлась би з першою.
 */
/**
 * 🔴 `new Function('s', 'return import(s)')`, А НЕ `await import(…)`, І ЦЕ
 * НЕ СТИЛЬ — ЦЕ ЄДИНЕ, ЩО ПРАЦЮЄ.
 *
 * `apps/api/tsconfig.json` каже `"module": "commonjs"`, тож TypeScript
 * перетворює звичайний `import()` на `require()`. Фетчер — ESM із
 * верхньорівневим `await`, і `require()` на ньому падає з
 * `ERR_REQUIRE_ASYNC_MODULE`. Заміряно 13.10.2026: перша редакція цього
 * файлу саме так і падала б — у продакшні, при першому ж оберті, бо
 * КОЖЕН тест підставляв свій `loader` і справжнього шляху не торкався.
 * `new Function` ховає виклик від компілятора, і це лишається справжнім
 * динамічним імпортом.
 *
 * 🔴 Шлях шукається вгору від цього файлу, а не від `cwd`: зібраний код
 * живе в `dist/`, і робоча тека служби задається systemd-ом, тобто поза
 * цим репозиторієм.
 */
const esmImport = new Function('s', 'return import(s)') as (
  s: string,
) => Promise<Record<string, unknown>>;

export const FETCHER_RELATIVE = join(
  'scripts',
  'meteoalarm',
  'fetch-warnings.mjs',
);

export function findFetcher(from: string = __dirname): string | null {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, FETCHER_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const loadFetcher = async (): Promise<Fetcher> => {
  const path = findFetcher();
  if (path === null) {
    throw new Error(`не знайшов ${FETCHER_RELATIVE} вгору від ${__dirname}`);
  }
  return (await esmImport(pathToFileURL(path).href)) as unknown as Fetcher;
};

@Injectable()
export class WarningsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WarningsService.name);
  private snapshot: Snapshot = NOTHING_YET;
  private timer: NodeJS.Timeout | null = null;
  private lastCalls = 0;

  constructor(
    private readonly deps: {
      loader?: () => Promise<Fetcher>;
      fetchImpl?: CollectDeps['fetchImpl'];
      now?: () => Date;
      intervalMs?: number;
    } = {},
  ) {}

  onModuleInit(): void {
    const every = this.deps.intervalMs ?? REFRESH_EVERY_MS;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), every);
    // Не тримати процес живим заради таймера.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Знімок, яким відповідає маршрут. Копії не робимо: він незмінний. */
  current(): Snapshot {
    return this.snapshot;
  }

  /** Скільки звернень до фідів зробив ОСТАННІЙ оберт. */
  callsLastCycle(): number {
    return this.lastCalls;
  }

  async refresh(): Promise<void> {
    const now = this.deps.now ?? (() => new Date());
    try {
      const fetcher = await (this.deps.loader ?? loadFetcher)();
      const result = await collect({
        countries: fetcher.countries,
        feedUrl: fetcher.feedUrl,
        warningsFrom: fetcher.warningsFrom,
        fetchImpl:
          this.deps.fetchImpl ??
          ((url: string) =>
            fetch(url) as unknown as ReturnType<CollectDeps['fetchImpl']>),
        now,
      });
      this.lastCalls = result.calls;
      this.snapshot = adopt(this.snapshot, result.snapshot, {
        countries: fetcher.countries.length,
        failed: result.failed.length,
      });
      if (result.failed.length > 0) {
        this.log.warn(
          `${result.failed.length} із ${fetcher.countries.length} фідів не відповіли: ` +
            `${result.failed.join(', ')}`,
        );
      }
    } catch (e) {
      // 🔴 Знімок НЕ чіпається. Він постаріє сам, і `warningState` скаже
      // `stale` — «ми не знаємо». Замінити його порожнім означало б
      // сказати «попереджень немає».
      this.log.error(`оновлення не вдалось: ${(e as Error).message}`);
    }

    const age = ageMinutes(this.snapshot, now());
    if (age !== null && age > FRESH_FOR_MINUTES) {
      this.log.warn(
        `знімок старший за ${FRESH_FOR_MINUTES} хв (${Math.round(age)}) — ` +
          'читачам буде показано «no fresh data», і це правильно',
      );
    }
  }
}
