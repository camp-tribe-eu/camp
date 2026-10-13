// CAMP-302: один оберт оновлювача — 27 фідів, один знімок.

import { withoutGeometry, type Snapshot, type Warning } from './snapshot';

export interface CollectDeps {
  /**
   * 🔴 ВЕЛИКИМИ ЛІТЕРАМИ, бо так це називає виробник.
   * `fetch-warnings.mjs` експортує `COUNTRIES`, а перша редакція читала
   * `fetcher.countries` — назву, яку я вигадав сам. Приведення типу це
   * ховало, `collect` падав на першому ж оберті, помилка ковталась, і
   * `GET /warnings` вічно віддавав порожнечу. Обидві сторони зʼєднання
   * мусять приходити від того, хто дані виробляє.
   */
  COUNTRIES: readonly string[];
  feedUrl: (country: string) => string;
  warningsFrom: (
    payload: unknown,
    country: string,
    now: Date,
  ) => { kept: Warning[]; seen?: number };
  /** Детектор «прогін побачив блоки й не лишив жодного» з фетчера. */
  yieldLooksBroken?: (x: {
    only: string | null;
    seen: number;
    kept: number;
  }) => boolean;
  fetchImpl: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  now: () => Date;
}

export interface CollectResult {
  snapshot: Snapshot;
  /**
   * Чи схоже, що прогін зламався, хоч ніхто й не «впав».
   *
   * 🔴 27 відповідей «200 OK», із яких не вийшло жодного попередження,
   * дають `failed = 0` — і знімок замінився б свіжим і порожнім. Це
   * рівно та брехня, проти якої написана картка.
   */
  looksBroken: boolean;
  /** Скільки разів ми звернулись до зовнішнього фіда за цей оберт. */
  calls: number;
  /** Країни, фід яких не відповів. Порожньо — усі відповіли. */
  failed: string[];
}

/**
 * Зняти знімок із усіх фідів.
 *
 * 🔴 `calls` повертається назовні НАВМИСНО. Картка вимагає довести, що
 * 27 фідів тягнуться раз на цикл, а не раз на запит читача — і довести
 * це можна лічильником, не припущенням. Без нього «ми ж не проксуємо»
 * лишалось би твердженням про намір.
 *
 * 🔴 ЧАСТКОВИЙ ПРОВАЛ — ЦЕ НЕ ПОРОЖНІЙ КОНТИНЕНТ. Якщо три фіди з 27 не
 * відповіли, знімок несе те, що приїхало, а назви трьох повертаються в
 * `failed`. Викинути весь знімок означало б сказати читачеві «попереджень
 * немає» там, де вони є.
 */
export async function collect(deps: CollectDeps): Promise<CollectResult> {
  const now = deps.now();
  const warnings: Warning[] = [];
  const failed: string[] = [];
  let calls = 0;
  let seen = 0;

  for (const country of deps.COUNTRIES) {
    calls += 1;
    try {
      const res = await deps.fetchImpl(deps.feedUrl(country));
      if (!res.ok) {
        failed.push(country);
        continue;
      }
      const payload = await res.json();
      const made = deps.warningsFrom(payload, country, now);
      seen += made.seen ?? 0;
      warnings.push(...made.kept);
    } catch {
      failed.push(country);
    }
  }

  const broken = deps.yieldLooksBroken ?? (() => false);
  return {
    snapshot: {
      fetchedAt: now.toISOString(),
      warnings: withoutGeometry(warnings),
    },
    calls,
    failed,
    looksBroken: broken({ only: null, seen, kept: warnings.length }),
  };
}
