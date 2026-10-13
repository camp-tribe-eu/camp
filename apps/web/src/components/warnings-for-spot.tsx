'use client';

import { useEffect, useState } from 'react';

import {
  applicableWarnings,
  warningState,
  type Warning,
  type WarningFeed,
  type WarningState,
} from '@/lib/warnings';
import { WarningPanel } from './warning-panel';

// CAMP-287 крок 4: панель нарешті стоїть на сторінці.
//
// 🔴 КЛІЄНТСЬКИЙ КОМПОНЕНТ, І ЦЬОГО НЕ ОМИНУТИ. Сторінки кемпінгів
// збираються наперед — усі 63 тисячі. Попередження мають бюджет
// свіжості десять хвилин (клаузула 5.6), тож укласти їх у збірку
// означає показати читачеві «No fresh data» завжди. Дані приходять у
// браузер, після того як сторінка вже на екрані.

export const WARNINGS_URL = '/data/warnings.json';

/**
 * Попередження для ОДНОГО кемпінга.
 *
 * 🔴 `codes` — це його власні зони, записані кроком 1. Зіставлення по
 * країні дало б хорватське попередження на кожному хорватському
 * кемпінгу, тобто тривогу там, де її немає; картка забороняє це прямо.
 *
 * 🔴 `null` і `[]` в `codes` — різні відповіді, і їх не можна злити:
 * `null` означає «резолвер сюди не дійшов», тож ми не знаємо, у якій
 * зоні цей кемпінг, і мовчати було б чеснішим, ніж сказати «нічого».
 */
export function WarningsForSpot({
  country,
  codes,
  fetchImpl,
  now,
}: {
  country: string;
  codes: string[] | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}) {
  const [feed, setFeed] = useState<WarningFeed | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (codes === null) return;
    let alive = true;
    const get = fetchImpl ?? fetch;
    void get(WARNINGS_URL)
      .then((r) => (r.ok ? (r.json() as Promise<WarningFeed>) : Promise.reject(new Error('нема'))))
      .then((f) => {
        if (alive) setFeed(f);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [codes, fetchImpl]);

  const state = panelStateFor({
    country,
    codes,
    feed,
    failed,
    now: (now ?? (() => new Date()))(),
  });
  return state === null ? null : <WarningPanel state={state} />;
}


/**
 * Що показати цьому кемпінгу — або нічого.
 *
 * 🔴 Винесено з компонента навмисно. Усе, що тут можна зіпсувати тихо,
 * — це рішення, а не розмітка, і доводити його треба без React, без
 * `useEffect` і без мережі. Компонент вище лишається тонким: він лише
 * приносить дані.
 */
export function panelStateFor({
  country,
  codes,
  feed,
  failed,
  now,
}: {
  country: string;
  codes: string[] | null;
  feed: WarningFeed | null;
  failed: boolean;
  now: Date;
}): WarningState | null {
  // 🔴 Резолвер сюди не дійшов — ми не знаємо, у якій зоні цей кемпінг.
  // Панель, яка в цьому стані каже «попереджень немає», збрехала б:
  // `null` це «не знаємо», а не «нічого».
  if (codes === null) return null;

  // Поки не приїхало — нічого. Порожня панель на мить прочиталась би
  // як «усе спокійно», а це твердження, якого ми ще не маємо права
  // робити.
  if (feed === null && !failed) return null;

  const warnings: readonly Warning[] = feed?.warnings ?? [];
  const { applicable, unlocatable } = applicableWarnings(country, codes, warnings);

  // 🔴 ТУТ СТОЯВ `failed ? null : feed`, І ЙОГО ПРИБРАНО ПІСЛЯ МУТАЦІЇ.
  // Жоден випадок не міг його почервонити: коли перший запит падає,
  // `feed` і так `null`, тож тернарник був тотожним. Єдиний стан, у
  // якому він щось робив, — повторний запит, що впав поверх уже
  // отриманого знімка; і там він був не нейтральний, а неправильний.
  // Знімок віком чотири хвилини чинний за клаузулою 5.6 незалежно від
  // того, чи вдався наступний запит, а тернарник перетворював його на
  // «немає свіжих даних». Вік судить `warningState` — тим самим
  // числом, яким судить ліцензія.
  return warningState(feed, applicable, now, unlocatable);
}
