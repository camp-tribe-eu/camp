// CAMP-302: один оберт оновлювача — 27 фідів, один знімок.

import { withoutGeometry, type Snapshot, type Warning } from './snapshot';

export interface CollectDeps {
  countries: readonly string[];
  feedUrl: (country: string) => string;
  warningsFrom: (
    payload: unknown,
    country: string,
    now: Date,
  ) => { kept: Warning[] };
  fetchImpl: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  now: () => Date;
}

export interface CollectResult {
  snapshot: Snapshot;
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

  for (const country of deps.countries) {
    calls += 1;
    try {
      const res = await deps.fetchImpl(deps.feedUrl(country));
      if (!res.ok) {
        failed.push(country);
        continue;
      }
      const payload = await res.json();
      warnings.push(...deps.warningsFrom(payload, country, now).kept);
    } catch {
      failed.push(country);
    }
  }

  return {
    snapshot: {
      fetchedAt: now.toISOString(),
      warnings: withoutGeometry(warnings),
    },
    calls,
    failed,
  };
}
