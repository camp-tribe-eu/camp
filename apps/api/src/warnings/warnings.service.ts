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

/**
 * Скільки чекати на ОДИН фід.
 *
 * 🔴 Двадцять секунд при пʼятихвилинному циклі: 27 фідів по 20 с — це
 * девʼять хвилин у найгіршому разі, тобто оберт усе одно може
 * перекритись, і саме тому поруч стоїть `running`. Але без таймауту
 * взагалі один мовчазний фід тримав би оберт 300 секунд (стандарт
 * undici) і робив би перекриття звичайною справою, а не крайнім разом.
 */
export const FEED_TIMEOUT_MS = 20_000;

/** Порожній знімок до першого оберту: часу немає, бо ми ще не питали. */
export const NOTHING_YET: Snapshot = { fetchedAt: null, warnings: [] };

type Fetcher = Pick<
  CollectDeps,
  'COUNTRIES' | 'feedUrl' | 'warningsFrom' | 'yieldLooksBroken'
>;

/** Імена, без яких оберт не має сенсу. Саме так їх називає виробник. */
const REQUIRED = ['COUNTRIES', 'feedUrl', 'warningsFrom'] as const;

/**
 * 🔴 ПЕРЕВІРКА ЗАМІСТЬ ПРИВЕДЕННЯ ТИПУ.
 *
 * Тут стояло `as unknown as Fetcher`, і воно ховало від компілятора те,
 * що служба читала `countries`, а модуль експортує `COUNTRIES`. Наслідок
 * рецензія заміряла: `collect` падав на першому ж оберті, помилка
 * ковталась, і `GET /warnings` вічно віддавав `{"fetchedAt":null,
 * "warnings":[]}`, скаржачись у лог раз на пʼять хвилин. Фіча була
 * мертва в продакшні й зелена в тестах.
 */
export function asFetcher(mod: Record<string, unknown>): Fetcher {
  const missing = REQUIRED.filter((k) => mod[k] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `фетчер не експортує ${missing.join(', ')} — ` +
        `є: ${Object.keys(mod).slice(0, 12).join(', ')}`,
    );
  }
  if (!Array.isArray(mod.COUNTRIES) || mod.COUNTRIES.length === 0) {
    throw new Error('COUNTRIES не масив або порожній');
  }
  return mod as unknown as Fetcher;
}

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
  return asFetcher(await esmImport(pathToFileURL(path).href));
};

@Injectable()
export class WarningsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WarningsService.name);
  private snapshot: Snapshot = NOTHING_YET;
  private timer: NodeJS.Timeout | null = null;
  private lastCalls = 0;
  /**
   * 🔴 Чи вже йде оберт.
   *
   * Без цього два оберти перекриваються: інтервал пʼять хвилин, а 27
   * послідовних фідів без таймауту можуть тягнутись довше (undici за
   * замовчуванням чекає заголовків 300 с на КОЖЕН). Той, що почався
   * пізніше, міг закінчитись раніше — і ранній перезаписував його,
   * відкочуючи `fetchedAt` НАЗАД на пʼять хвилин.
   */
  private running = false;

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
    if (this.running) {
      this.log.warn('попередній оберт ще йде — цей пропущено');
      return;
    }
    this.running = true;
    const now = this.deps.now ?? (() => new Date());
    try {
      const fetcher = await (this.deps.loader ?? loadFetcher)();
      const result = await collect({
        COUNTRIES: fetcher.COUNTRIES,
        feedUrl: fetcher.feedUrl,
        warningsFrom: fetcher.warningsFrom,
        yieldLooksBroken: fetcher.yieldLooksBroken,
        fetchImpl:
          this.deps.fetchImpl ??
          // 🔴 Із таймаутом. Без нього один мовчазний фід тримає оберт
          // довше за інтервал (undici чекає заголовків 300 с), і
          // перекриття обертів стає звичайною справою.
          ((url: string) =>
            fetch(url, {
              signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
            }) as unknown as ReturnType<CollectDeps['fetchImpl']>),
        now,
      });
      this.lastCalls = result.calls;
      this.snapshot = adopt(this.snapshot, result.snapshot, {
        countries: fetcher.COUNTRIES.length,
        failed: result.failed.length,
        looksBroken: result.looksBroken,
      });
      if (result.failed.length > 0) {
        this.log.warn(
          `${result.failed.length} із ${fetcher.COUNTRIES.length} фідів не відповіли: ` +
            `${result.failed.join(', ')}`,
        );
      }
    } catch (e) {
      // 🔴 Знімок НЕ чіпається. Він постаріє сам, і `warningState` скаже
      // `stale` — «ми не знаємо». Замінити його порожнім означало б
      // сказати «попереджень немає».
      this.log.error(`оновлення не вдалось: ${(e as Error).message}`);
    } finally {
      this.running = false;
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
