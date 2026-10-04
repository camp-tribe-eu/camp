'use client';

import { useEffect, useState } from 'react';
import {
  AIR_ATTRIBUTION,
  AIR_SOURCE_CREDIT,
  AIR_SOURCE_ID,
  airState,
  formatKm,
  hourLabel,
  levelLabel,
  levelText,
  MODELLED_STATION_WORDING,
  modelledPointWording,
  NO_FRESH_DATA,
  noDataSentence,
  noFreshDataSentence,
  noParticulatesSentence,
  readAtLabel,
  REPORTED_WORDING,
  STATION_KIND_LABEL,
  type AirState,
} from '@/lib/air-quality';
import { SOURCES } from '@/lib/sources';

// CAMP-164 — what the EEA's air quality index says beside a campsite.
//
// 🔴 EXACTLY ONE OF SIX THINGS, AND NEVER NOTHING.
//
//     reported        the nearest station reported every pollutant behind
//                     its index for the hour shown
//     mixed           some were reported and some are modelled estimates
//     modelled        no station within 15 km: the EEA's 1 km model — a
//                     model, not a reading, and worded as one
//     no-fresh-data   a station is there and is not reporting, or what we
//                     hold has aged past four hours — the third of the
//                     card's three display requirements
//     no-data         nothing covers this spot, or the payload could not
//                     be read
//
// One section, one `data-state`. The state is a function of the facts and
// of a clock (`airState`), so the same facts can be `reported` at build
// time and `no-fresh-data` in a browser open four hours later.
//
// 🔴 THIS IS A CLIENT COMPONENT ONLY FOR THE CLOCK. Server-rendered, it
// prints the state at build time, which is the HTML a crawler and a
// reader without JavaScript are served. On mount the browser hands its
// own clock to the same pure `airState`, and a reading that has aged past
// the budget turns into "no fresh data" on a page nobody has rebuilt. The
// first client render uses the build time the server used, so the two
// agree and there is no hydration mismatch.
//
// 🔴 A MODEL IS TOLD APART FROM A READING BY WORDS THAT ARE ON THE PAGE:
// "Modelled estimate" in the basis line and beside the pollutant it
// belongs to. The dashed edge on the model's container is decoration on
// top of that, and nothing relies on it: a test reads words, and a class a
// stylesheet could change is not a statement the page makes. And not one
// colour anywhere — red means danger to every reader alive, and the EEA
// has not said anything is.
//
// 🔴 THE WORDING "AS REPORTED TO THE EEA, NOT FORMALLY VERIFIED" IS
// PRINTED UNDER A REPORT AND NEVER UNDER A MODEL. Saying it of something
// nobody reported would be the misrepresentation it is there to prevent.

/** How often a page left open re-reads its own clock. */
const TICK_MS = 5 * 60_000;

export default function AirQualityNote({
  airQuality,
  renderedAt,
  className = '',
}: {
  /**
   * The API's facts. 🔴 `undefined` and `null` mean "we hold nothing" and
   * BOTH render a sentence saying so: the API and the site deploy
   * separately, and a payload written before this field existed must
   * produce a page that says what it does not know, not one that quietly
   * drops the section on every campsite in Europe.
   */
  airQuality: unknown;
  /**
   * When the server rendered, ISO. It is the clock of the first render on
   * both sides; the browser replaces it with its own straight after.
   */
  renderedAt: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date(renderedAt));

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <AirQualityPanel state={airState(airQuality, now)} className={className} />
  );
}

/**
 * The panel for one state. No hooks and no clock, so a unit test renders
 * it to the same HTML the page does with one call.
 */
export function AirQualityPanel({
  state,
  className = '',
}: {
  state: AirState;
  className?: string;
}) {
  const source = SOURCES[AIR_SOURCE_ID];
  const modelledPoint = state.state === 'modelled';
  const readAt =
    state.state === 'reported' || state.state === 'mixed'
      ? state.reading.readAt
      : state.state === 'modelled'
        ? state.readAt
        : null;

  return (
    <section
      data-testid="air-quality"
      data-state={state.state}
      aria-labelledby="air-quality-heading"
      className={`mt-8 ${className}`}
    >
      {/* 🔴 The heading is the same words on every page, so the near-duplicate
          guard excludes it — the same rule as every other constant here:
          only text that is identical on EVERY page it appears on. */}
      <h2
        id="air-quality-heading"
        className="text-xl font-bold md:text-[25px]"
        data-boilerplate="air-heading"
      >
        Air quality
      </h2>

      <div
        className={
          'mt-3 rounded-card border bg-surface-2 p-4 ' +
          // A dashed edge where a measured value has a solid one. Decoration
          // only — the words in the basis line are what say it is a model.
          (modelledPoint ? 'border-dashed border-ink-2' : 'border-line-2')
        }
      >
        {(state.state === 'reported' || state.state === 'mixed') && (
          <Reading state={state} />
        )}
        {state.state === 'modelled' && <Modelled state={state} />}
        {state.state === 'no-fresh-data' && (
          <p className="max-w-prose text-sm leading-6 text-ink-2">
            <strong
              className="text-heading"
              data-testid="air-no-fresh-data"
              data-boilerplate="air-no-fresh-data"
            >
              {NO_FRESH_DATA}
            </strong>{' '}
            <span data-testid="air-no-fresh-data-why">
              {noFreshDataSentence(state)}
            </span>
          </p>
        )}
        {state.state === 'no-data' && (
          // 🔴 One sentence per reason, identical on every page in that
          // state: 20 of the 72 fixture pages, and in the real data the
          // 666 campsites (1.1%) that have no station within 15 km AND lie
          // outside the model. Marked, or two such pages differ from one
          // another by nothing but their neighbours: CAMP-168 shipped the
          // same guard red, and it was this same pair of Croatian pages.
          <p
            className="max-w-prose text-sm leading-6 text-ink-2"
            data-testid="air-no-data"
            data-boilerplate="air-no-data"
          >
            {noDataSentence(state.reason)}
          </p>
        )}

        {/* 🔴 Attribution, rendered, in EVERY state — including the two
            that hold no value. "No station lies within 15 km" is a claim
            made on the EEA's roster just as much as a level is, and it is
            attributed. The EEA legal notice makes acknowledgement a
            condition of reuse, and the date is where the reader can see
            how old what they are looking at is: the HOUR is printed
            beside the value, and this is when we read the file. */}
        <p className="mt-4 border-t border-line-2 pt-3 text-xs leading-5 text-ink-2">
          <a
            href={source.url}
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
            data-boilerplate="source"
          >
            {source.name}
          </a>
          {' · '}
          <a
            href={source.licenceUrl}
            className="underline"
            rel="license noopener noreferrer"
            target="_blank"
            data-boilerplate="licence"
          >
            {source.licence}
          </a>
          {' · '}
          <span data-testid="air-attribution">
            {/* TWO constants, not a retyped sentence — AIR_ATTRIBUTION is
                the EEA's own sentence about the index, AIR_SOURCE_CREDIT is
                the acknowledgement of source their terms require. Both
                inside the marked span, because both are boilerplate.
                Word-for-word the same on every page, so the near-duplicate
                guard excludes it; the date stays OUTSIDE the marked span,
                because it is the part that is only there when there is a
                reading. */}
            {/* 🔴 ONE template literal, not `{A} {B}`. Two adjacent
                expressions are two text nodes, and the server renderer
                separates those with a <!-- --> comment — which would sit
                inside the attribution a reader is meant to be able to
                copy, and would break the markup the e2e asserts. */}
            <span data-boilerplate="air-attribution">
              {`${AIR_ATTRIBUTION} ${AIR_SOURCE_CREDIT}`}
            </span>
            {readAt && (
              <>
                {' '}
                {source.dateLabel}{' '}
                <time dateTime={readAt}>{readAtLabel(readAt)}</time>.
              </>
            )}
          </span>
        </p>
      </div>
    </section>
  );
}

function Reading({
  state,
}: {
  state: Extract<AirState, { state: 'reported' | 'mixed' }>;
}) {
  const { station, reading } = state;
  const mixed = state.state === 'mixed';
  const modelledCount = reading.pollutants.filter((p) => p.modelled).length;
  const culprit = reading.pollutants.find(
    (p) => p.pollutant === reading.culprit,
  );
  const particulates = noParticulatesSentence(reading.pollutants);
  const place =
    station.municipality && station.municipality !== station.name
      ? `${station.name}, ${station.municipality}`
      : station.name;

  return (
    <>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-y-2">
        {/* 🔴 The NAME of the station, its kind and how far it is. Without
            those a level is a floating adjective attached to a campsite,
            which is exactly the claim we are not making — and a traffic
            station's air is not a campsite's air. */}
        <dt className="text-ink-2" data-boilerplate="air-label">
          Nearest station
        </dt>
        <dd className="mb-2 text-heading sm:mb-0" data-testid="air-station">
          {place}
          {` — ${STATION_KIND_LABEL[station.type]}, `}
          <span className="tabular-nums">{formatKm(station.metres)}</span>
          {' from this campsite'}
        </dd>

        <dt className="text-ink-2">
          European Air Quality Index,{' '}
          <time dateTime={reading.hour}>{hourLabel(reading.hour)}</time>
        </dt>
        <dd className="mb-2 font-semibold text-heading sm:mb-0" data-testid="air-index">
          {levelText(reading.band)}
        </dd>

        <dt className="text-ink-2" data-boilerplate="air-label">
          Basis
        </dt>
        <dd
          className="mb-2 text-heading sm:mb-0"
          data-testid="air-basis"
          data-basis={state.state}
        >
          {mixed
            ? `Partly modelled: ${modelledCount} of ${reading.pollutants.length} pollutants ${
                modelledCount === 1 ? 'is a modelled estimate' : 'are modelled estimates'
              }, not measurements`
            : 'Reported by the station'}
        </dd>

        <dt className="text-ink-2" data-boilerplate="air-label">
          Pollutants
        </dt>
        <dd className="text-heading">
          <ul data-testid="air-pollutants">
            {reading.pollutants.map((p) => (
              <li key={p.pollutant} data-modelled={p.modelled ? 'true' : 'false'}>
                {p.pollutant}
                {' — '}
                <span className="tabular-nums">{p.value} µg/m³</span>
                {`, ${levelLabel(p.band)}`}
                {p.modelled && (
                  <>
                    {' — '}
                    <em className="border-b border-dashed border-ink-2 not-italic">
                      modelled estimate
                    </em>
                  </>
                )}
              </li>
            ))}
          </ul>
        </dd>
      </dl>

      {/* 🔴 The pollutant that sets the level, and whether it is one of
          the modelled ones — the case in which "reported" would be the
          wrong word for the headline. */}
      <p
        className="mt-3 max-w-prose text-sm leading-6 text-ink-2"
        data-testid="air-culprit"
      >
        {`The level is set by ${reading.culprit}`}
        {culprit?.modelled ? ', which is a modelled estimate' : ''}
        {'.'}
      </p>

      {particulates && (
        <p
          className="mt-2 max-w-prose text-sm leading-6 text-ink-2"
          data-testid="air-no-particulates"
          data-boilerplate="air-no-particulates"
        >
          {particulates}
        </p>
      )}

      <p
        className="mt-2 max-w-prose text-sm leading-6 text-ink-2"
        data-testid="air-wording"
        data-boilerplate="air-wording"
      >
        {REPORTED_WORDING}
      </p>

      {mixed && (
        <p
          className="mt-2 max-w-prose text-sm leading-6 text-ink-2"
          data-testid="air-modelled-wording"
          data-boilerplate="air-modelled-station"
        >
          {MODELLED_STATION_WORDING}
        </p>
      )}
    </>
  );
}

function Modelled({
  state,
}: {
  state: Extract<AirState, { state: 'modelled' }>;
}) {
  return (
    <>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-y-2">
        <dt className="text-ink-2">
          Modelled index for this location,{' '}
          <time dateTime={state.hour}>{hourLabel(state.hour)}</time>
        </dt>
        <dd className="mb-2 font-semibold text-heading sm:mb-0" data-testid="air-index">
          {levelText(state.band)}
        </dd>

        <dt className="text-ink-2">Basis</dt>
        <dd
          className="mb-2 text-heading sm:mb-0"
          data-testid="air-basis"
          data-basis="modelled"
        >
          <em className="border-b border-dashed border-ink-2 not-italic">
            Modelled estimate
          </em>
          {', not a measurement'}
        </dd>
      </dl>

      <p
        className="mt-3 max-w-prose text-sm leading-6 text-ink-2"
        data-testid="air-modelled-wording"
        data-boilerplate="air-modelled-point"
      >
        {modelledPointWording()}
      </p>
    </>
  );
}
