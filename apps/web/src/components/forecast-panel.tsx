'use client';

import { useEffect, useRef, useState } from 'react';

import { TrustMark } from '@/components/trust';
import type { Origin } from '@/lib/trust';
import { trustOf } from '@/lib/trust';
import {
  CC_BY_URL,
  FORECAST_ORIGIN,
  CONDITION_LABEL,
  OPEN_METEO_URL,
  dayLabel,
  forecastUrl,
  runLabel,
  formatDeg,
  formatMm,
  watchForForecast,
  type Condition,
  type Forecast,
} from '@/lib/forecast';

// CAMP-477 — a seven-day forecast for the campsite, or nothing.
//
// 🔴 THE PANEL IS PURE AND THE FETCH IS NOT: `ForecastPanel` below has no
// hooks, so a test renders it to the HTML the page serves; `ForecastNote`
// is the thin client wrapper that brings the data. Where the data comes
// from and why it is not in the built page: lib/forecast.ts.
//
// 🔴 NO DATA, NO SECTION. Until a forecast has arrived — and for ever if
// it does not — the wrapper draws one inert, empty, one-pixel block that
// exists only so the browser can tell when the reader is near. It has no
// border, no heading and no words.
//
// 🔴 WHAT THE NUMBERS ARE, SAID TO THE READER. A model's grid point, about
// 25 km across: on a coast or in a valley the campsite's own weather can
// differ. That sentence is part of the panel, not a footnote to be cut.
//
// 🔴 THE ECMWF CREDIT IS A CONDITION, NOT A COURTESY. ECMWF's terms of use
// for its open data (apps.ecmwf.int/datasets/licences/general, read
// 16.11.2026) say it «must be acknowledged (attributed) as the source.
// Attribution must be displayed prominently and include ‘this
// document/data/output/Results is/are based on data and products of the
// European Centre for Medium-Range Weather Forecasts (ECMWF)’». The
// sentence in the credit line below is that wording; a test reads it out
// of the rendered HTML.

export function ForecastNote({
  slug,
}: {
  slug: string;
}) {
  const [forecast, setDays] = useState<Forecast | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const url = forecastUrl(slug);

  useEffect(() => {
    return watchForForecast(sentinel.current, url, setDays, {
      fetchImpl: (u) => fetch(u),
      observe:
        typeof IntersectionObserver === 'undefined'
          ? undefined
          : (el, onNear) => {
              const io = new IntersectionObserver(
                (entries) => {
                  if (entries.some((e) => e.isIntersecting)) {
                    io.disconnect();
                    onNear();
                  }
                },
                { rootMargin: '400px' },
              );
              io.observe(el);
              return () => io.disconnect();
            },
    });
  }, [url]);

  if (!forecast) {
    return (
      <div
        ref={sentinel}
        data-testid="forecast-sentinel"
        aria-hidden="true"
        className="h-px"
      />
    );
  }
  return <ForecastPanel forecast={forecast} />;
}

export function ForecastPanel({
  forecast,
  origin = FORECAST_ORIGIN,
}: {
  forecast: Forecast;
  /** A seam for the test that proves the word is derived; production passes none. */
  origin?: Origin;
}) {
  const { days, runAt } = forecast;
  if (days.length === 0) return null;
  // 🔴 DERIVED, NOT TYPED: the word comes from `trustOf`, like every other
  // status on the page. We work the daily figures out from an outside
  // model, which the trust vocabulary calls `derived` → "Imported".
  const status = trustOf(origin);
  return (
    <section
      data-testid="forecast"
      aria-labelledby="forecast-heading"
      className="mt-8"
    >
      {/* The heading and the words under it are the same on every page, so
          the near-duplicate guard leaves them out (`data-boilerplate`, the
          rule scripts/seo/check-duplicate-pages.mjs states). The numbers
          are not marked: they are what differs between two campsites. */}
      <h2
        id="forecast-heading"
        className="text-xl md:text-[25px]"
        data-boilerplate="forecast-heading"
      >
        {days.length}-day forecast
      </h2>

      <div className="mt-3 rounded-card border border-line-2 bg-surface-2 p-4 text-sm text-ink-2">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Daily forecast for the next {days.length} days
          </caption>
          <thead>
            <tr className="text-xs text-ink-2">
              <th scope="col" className="pb-2 pr-3 font-normal">Day</th>
              <th scope="col" className="pb-2 pr-3 font-normal">Sky</th>
              <th scope="col" className="pb-2 pr-3 text-right font-normal">
                High / low
              </th>
              <th scope="col" className="pb-2 text-right font-normal">Rain</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr
                key={d.date}
                data-testid="forecast-day"
                data-date={d.date}
                className="border-t border-line-2"
              >
                <th
                  scope="row"
                  className="whitespace-nowrap py-2 pr-3 font-semibold text-heading"
                >
                  {dayLabel(d.date)}
                </th>
                <td className="py-2 pr-3 text-heading">
                  <span className="inline-flex items-center gap-2">
                    <SkyIcon condition={d.condition} />
                    <span>{CONDITION_LABEL[d.condition]}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-heading">
                  <span className="font-semibold">{formatDeg(d.tMax)}</span>
                  {' / '}
                  <span>{formatDeg(d.tMin)}</span>
                </td>
                <td className="whitespace-nowrap py-2 text-right tabular-nums text-heading">
                  {formatMm(d.precipMm)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-3 border-t border-line-2 pt-3 text-xs leading-5 text-ink-2" data-testid="forecast-trust">
          <TrustMark status={status} className="font-semibold text-heading" />
          {' · '}
          Model: ECMWF IFS, via Open-Meteo.
          {runAt ? ` Model run ${runLabel(runAt)}.` : ''} Updated about every 6
          hours. A forecast for the area (about 25 km), not for the pitch.
        </p>

        <p
          className="mt-3 border-t border-line-2 pt-3 text-xs leading-5 text-ink-2"
          data-boilerplate="forecast-credit"
        >
          A model forecast for the area around the campsite, about 25 km
          across, not for the pitch itself: coasts and valleys can differ.
          Based on data and products of the European Centre for
          Medium-Range Weather Forecasts (ECMWF); the daily values are worked
          out by us.{' '}
          <a
            href={OPEN_METEO_URL}
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            Weather data by Open-Meteo.com
          </a>{' '}
          (
          <a
            href={CC_BY_URL}
            className="underline"
            rel="license noopener noreferrer"
            target="_blank"
          >
            CC BY 4.0
          </a>
          )
        </p>
      </div>
    </section>
  );
}

/** A small line icon per sky word; decorative, the word beside it says it. */
function SkyIcon({ condition }: { condition: Condition }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  const sun = (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  );
  const cloud = (
    <path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.5a4.2 4.2 0 0 1 .5 8.5H7z" />
  );
  switch (condition) {
    case 'clear':
      return <svg {...common}>{sun}</svg>;
    case 'partly-cloudy':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 2v1M2 8h1M3.8 3.8l.7.7M12.2 3.8l-.7.7" />
          <path d="M9 20a3.5 3.5 0 0 1-.4-6.98A4.8 4.8 0 0 1 18 12.5a3.7 3.7 0 0 1 .5 7.5H9z" />
        </svg>
      );
    case 'cloudy':
      return <svg {...common}>{cloud}</svg>;
    case 'rain':
      return (
        <svg {...common}>
          <path d="M7 15a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 6.5a4.2 4.2 0 0 1 .5 8.5H7z" />
          <path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" />
        </svg>
      );
    case 'heavy-rain':
      return (
        <svg {...common}>
          <path d="M7 14a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 5.5a4.2 4.2 0 0 1 .5 8.5H7z" />
          <path d="M8 17l-1.5 4M12 17l-1.5 4M16 17l-1.5 4M10 17.5l-1 3M14 17.5l-1 3" />
        </svg>
      );
    case 'snow':
      return (
        <svg {...common}>
          <path d="M7 14a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 5.5a4.2 4.2 0 0 1 .5 8.5H7z" />
          <path d="M9 18v.01M13 18v.01M17 18v.01M11 21v.01M15 21v.01" strokeWidth={2.4} />
        </svg>
      );
  }
}
