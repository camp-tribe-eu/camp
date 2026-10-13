// CAMP-287 крок 4: шлях, яким попередження доходять до читача.
//
// 🔴 ДИНАМІЧНИЙ МАРШРУТ, А НЕ ФАЙЛ — і це не стиль, це клаузула 5.6
// ліцензії MeteoAlarm. Пожежі поруч (`/data/wildfires.json`) віддаються
// закоміченим файлом, бо їхній бюджет свіжості — 72 години. У
// попереджень він **десять хвилин**: знімок, закомічений уночі,
// приїхав би до читача віком у години, і панель показувала б «No fresh
// data» ЗАВЖДИ. Це доведено в CAMP-302.
//
// 🔴 І ЦЕ НЕ ПРОКСІ ДО METEOALARM. Запит іде до нашого ж API, який
// тримає знімок у памʼяті й оновлює його раз на пʼять хвилин: 27 фідів
// на кожного відвідувача — це і наш трафік, і їхній.
//
// 🔴 ЧОМУ ЧЕРЕЗ ВЕБ, А НЕ ПРЯМО З БРАУЗЕРА. Caddy проксує назовні лише
// порт 3000 (цей застосунок); API на 3001 публічного шляху не має й не
// повинен мати. Заміряно 13.10.2026 у `/etc/caddy/Caddyfile`.

import { NextResponse } from 'next/server';

import { CACHE_SECONDS, toFeed } from '@/lib/warnings-feed';

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

/**
 * 🔴 Ніколи не статичний.
 *
 * `force-static` тут перетворив би знімок на вічний: Next віддавав би
 * той самий `fetchedAt` до наступної збірки, тобто добу.
 */
export const dynamic = 'force-dynamic';

// 🔴 ФУНКЦІЯ, А НЕ КОНСТАНТА. Тіло `Response` читається один раз;
// спільний екземпляр на всі запити віддав би другому читачеві
// вичерпаний потік.
//
// 🔴 503, а не 200 з порожнім тілом. Клієнт перевіряє `r.ok`, і саме
// так «ми не змогли прочитати» стає `nothing-arrived`, а не `clear`.
const nothingArrived = () =>
  NextResponse.json(
    { error: 'no snapshot' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );

export async function GET() {
  try {
    const res = await fetch(`${API}/warnings`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return nothingArrived();
    const feed = toFeed(await res.json());
    if (feed === null) return nothingArrived();
    return NextResponse.json(feed, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
  } catch {
    return nothingArrived();
  }
}
