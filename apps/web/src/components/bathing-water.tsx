import {
  BATHING_ATTRIBUTION,
  BATHING_RADIUS_M,
  BATHING_SOURCE_ID,
  categoryLabel,
  isClassified,
  noBathingWaterSentence,
  notClassifiedSentence,
  seasonContextSentence,
  seasonLabel,
  seasonSentence,
  statusLabel,
  type BathingWater,
} from '@/lib/bathing';
import { SOURCES } from '@/lib/sources';
import { formatDistance } from '@/lib/api';

// CAMP-168 — the official bathing water classification, beside a campsite.
//
// 🔴 THE HEADING CARRIES THE YEAR, AND SO DOES THE CLASS.
//
// Everything about this section is arranged so a reader cannot come away
// thinking they have been told the state of the water today. The heading
// says "2025 bathing season". The class sits under a label that repeats
// the season. The sentence beneath says the classification covers a
// whole season and that a new one comes out about a year later. Three
// statements of the same fact is not redundancy on a page somebody scans
// in eight seconds — it is the minimum for the one misreading that would
// actually hurt somebody.
//
// 🔴 NEVER RENDERS NOTHING. Three states, all of them visible:
//
//     a classified bathing water within 2 km   18 082 campsites (29.4%)
//     one within 2 km, "Not classified"           523 campsites (0.8%)
//     none within 2 km                         42 953 campsites (69.8%)
//
// (Measured 28.09.2026 over all 61 558 campsites with
// api/src/bathing/report-coverage.ts.)
//
// The third is the one that matters. 70% of our pages are in it, and a
// section that simply disappeared on all of them would let an absence
// read as reassurance — and would make a campsite whose bathing water we
// failed to import look exactly like one that genuinely has none.
//
// 🔴 NO COLOUR CODING. A green badge on "Excellent" and a red one on
// "Poor" is the CAMP-162 forbidden vocabulary rendered in CSS: red means
// danger to every reader alive, and the EEA has not said this water is
// dangerous — it has said its four-year statistics fall in the lowest of
// four classes. The class is set in the same ink as the rest of the page
// and is allowed to speak for itself.

export default function BathingWaterNote({
  bathingWater,
  className = '',
}: {
  /**
   * 🔴 `undefined` and `null` mean the same thing here — no designated
   * bathing water within the radius — and BOTH render the empty-state
   * sentence rather than nothing. The API and the site deploy
   * separately; a payload written before this field existed must produce
   * a page that says what it does not know, not a page that quietly
   * drops the section on every campsite in Europe.
   */
  bathingWater: BathingWater | null | undefined;
  className?: string;
}) {
  const source = SOURCES[BATHING_SOURCE_ID];

  return (
    <section
      data-testid="bathing-water"
      aria-labelledby="bathing-water-heading"
      className={`mt-8 ${className}`}
    >
      <h2
        id="bathing-water-heading"
        className="text-xl font-bold md:text-[25px]"
      >
        {/* 🔴 The season is in the HEADING, not only in the body. A
            reader who reads one line of this section reads the year.

            🔴 And it comes from the RECORD, never from a default. There
            is deliberately no `?? 2025` here: with no bathing water
            there is no season, and a heading that names one anyway would
            be stating a year we do not have a classification for — on
            the 69.8% of pages where we have nothing at all. */}
        {bathingWater
          ? `Bathing water, ${seasonLabel(bathingWater.season)}`
          : 'Bathing water'}
      </h2>

      <div className="mt-3 rounded-card border border-line-2 bg-surface-2 p-4">
        {bathingWater ? (
          <Classification bw={bathingWater} />
        ) : (
          <p className="max-w-prose text-sm leading-6 text-ink-2">
            {noBathingWaterSentence(BATHING_RADIUS_M)}
          </p>
        )}

        {/* 🔴 Attribution, rendered, with the season in it — not a
            constant in a file nobody opens. The EEA legal notice makes
            acknowledgement a condition of reuse and adds that the
            original meaning must not be distorted; a classification
            printed without its season is that distortion, so the
            attribution repeats the year one last time.

            🔴 It is printed in ALL THREE states, including the empty
            one. The radius sentence is derived from the EEA's register
            of designated bathing waters just as much as a class is —
            saying "there is none within 2 km" is a claim made on their
            data, and it is attributed. */}
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
          <span data-testid="bathing-attribution">
            {/* 🔴 The CONSTANT, not a retyped sentence. This block used to
                hard-code "…bathing waters … Member States authorities."
                under a comment saying "verbatim" — the service's own
                text is "Bathing waters … Member states authorities.",
                and the licence makes acknowledgement a condition of
                reuse. The season is appended only where there is one to
                name. */}
            {/* 🔴 Boilerplate for the near-duplicate guard: word-for-word
                the same on every page, a promise about all of them
                rather than a statement about one. The season stays
                OUTSIDE the marked span — it is the part that is only
                there when there is a classification. */}
            <span data-boilerplate="bathing-attribution">
              {BATHING_ATTRIBUTION}
            </span>
            {bathingWater ? ` ${seasonLabel(bathingWater.season)}.` : ''}
          </span>
        </p>
      </div>
    </section>
  );
}

function Classification({ bw }: { bw: BathingWater }) {
  const label = statusLabel(bw);

  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-2">Bathing water</dt>
        <dd className="text-heading">
          {/* 🔴 The NAME of the place that was sampled, and how far it is
              from the campsite. Without those two facts the class is a
              floating adjective attached to a campsite, which is exactly
              the claim we are not making. */}
          {bw.profileUrl ? (
            <a
              href={bw.profileUrl}
              className="underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {bw.name}
            </a>
          ) : (
            bw.name
          )}
          {` — ${categoryLabel(bw.category)}, `}
          <span className="tabular-nums">{formatDistance(bw.metres)}</span>
          {' from this campsite'}
        </dd>

        {/* 🔴 The label carries the season too. Somebody skimming the
            definition list alone still meets the year. */}
        <dt className="text-ink-2">
          Official classification, {seasonLabel(bw.season)}
        </dt>
        <dd className="font-semibold text-heading" data-testid="bathing-status">
          {label ?? 'Not classified'}
        </dd>
      </dl>

      <p className="mt-3 max-w-prose text-sm leading-6 text-ink-2">
        {isClassified(bw) ? seasonSentence(bw) : notClassifiedSentence(bw)}
      </p>

      {/* 🔴 Printed under both, because "Not classified" on its own reads
          as an omission of ours rather than as the authorities' own
          answer for that season.

          🔴 And it is `seasonContextSentence`, not `seasonSentence`. The
          first version printed "Classified by the national authorities
          for the 2025 bathing season" here too — on a record whose class
          is "Not classified", two lines above. Every string was true on
          its own and every test was green; it was visible only by
          opening the page.

          🔴 `data-boilerplate`, and the reason is a red CI job. This
          paragraph is word-for-word the same on every page that has a
          designated bathing water, so it is a promise about all of them
          and not a statement about one. Left in the comparison it took
          hr/zadarska/autocamp-punta and autocamp-tabor — two pages that
          already sat at 79.6% WITHOUT this section — to 81.9%, above the
          guard's 80% line (scripts/seo/check-duplicate-pages.mjs, the
          `web` job; red on this PR from its first push). Only text that
          is identical on every page it appears on may carry the marker:
          what varies with the subject (the name, the class, the
          distance, the sentence that says whether it was classified)
          stays in the comparison, because that is what the guard is for.

          🔴 AND YES, IT INTERPOLATES A VALUE — `${season}` — which looks
          like exactly the thing the rule forbids. It is safe, and not by
          luck: the read query pins every record to
          `max(season)` for the one source
          (`apps/api/src/bathing/nearby.ts`, asserted in `nearby.spec.ts`),
          so every page in a build carries the same year. Review raised
          this and it is written down here rather than re-derived: if that
          subquery ever becomes per-record, this marker has to go. */}
      <p
        className="mt-2 max-w-prose text-sm leading-6 text-ink-2"
        data-boilerplate="bathing-season-context"
      >
        {seasonContextSentence(bw.season)}
      </p>
    </>
  );
}
