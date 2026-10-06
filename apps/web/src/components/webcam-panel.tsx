'use client';

import { useEffect, useState } from 'react';
import {
  WINDY_CREDIT,
  absence,
  direction,
  distance,
  frameUrl,
  WEBCAM_RADIUS_M,
  reportedMinutesAgo,
  reportedPhrase,
  shortTitle,
  showable,
  type Webcam,
} from '@/lib/webcams';

// CAMP-190 — the nearest webcams, as pictures a reader can look at.
//
// 🔴 A STATIC <img>, NOT THE PLAYER IFRAME, and the reasons are measured:
//
//   weight      17 KB of JPEG against somebody else's JavaScript bundle
//   privacy     no third-party cookies, so no consent question
//   speed       nothing blocking on a page that is mostly text
//
// The timelapse player lives one click away on Windy's own page — which
// is also their condition for using the image at all, so the link is not
// a courtesy, it is the licence.
//
// 🔴 NOTHING HERE CLAIMS THE CAMERA SHOWS THE CAMPSITE.
//
// At 25 km it is the next valley. Every card prints its distance, and
// the heading says "near", for the same reason the air quality panel
// says "the nearest station is 12 km away" instead of "the air here is".
//
// 🔴 AND THE PANEL IS NEVER EMPTY. 12% of campsites have no camera
// within 25 km (CAMP-189) — Lithuania had none at any sampled site — and
// a blank space reads as a broken page, not as an absence.

/** How often the phrase re-reads the clock. The same cadence as air quality. */
const TICK_MS = 5 * 60 * 1000;

/**
 * 🔴 THE CLOCK LIVES HERE, AND THE PANEL BELOW IS PURE — the same split
 * `air-quality.tsx` uses, and for the same two reasons.
 *
 * These pages are statically generated and read for days, so a
 * server-rendered "reported 11 minutes ago" freezes at build time.
 * Review found that literal string in the HTML, and the test meant to
 * catch it was asserting the stale phrase.
 *
 * And a component with hooks cannot be driven by the unit harness
 * (`renderToStaticMarkup` has no dispatcher), so the part that is
 * checked word by word for the CEMS rule must hold no state at all.
 */
export function WebcamNote({
  webcams,
  renderedAt,
}: {
  webcams: Webcam[] | null | undefined;
  /** The build's clock. The reader's takes over as soon as they arrive. */
  renderedAt: string;
}) {
  const [now, setNow] = useState(() => new Date(renderedAt));

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return <WebcamPanel webcams={webcams} now={now} />;
}

export function WebcamPanel({
  webcams,
  now,
}: {
  webcams: Webcam[] | null | undefined;
  /** Whatever clock the caller is keeping. No `new Date()` in here. */
  now: Date;
}) {
  const cams = showable(webcams, now);
  const why = absence(webcams, now);

  // 🔴 NOTHING AT ALL when there is nothing we can honestly say: the
  // catalogue is not imported, or the only rows near here are ones we
  // cannot use. Every other branch of this panel makes a claim, and
  // those two states have no claim to make — see `absence` in
  // lib/webcams.ts.
  if (why === 'unknown') return null;

  return (
    <section
      data-testid="webcam-note"
      data-count={String(cams.length)}
      aria-labelledby="webcams-heading"
      className="mt-8"
    >
      {/* 🔴 `data-boilerplate` from here down on everything that does not
          move with the campsite — the rule `scripts/seo/check-duplicate-pages.mjs`
          states: a block earns the mark only if it is identical on every
          page it appears on.

          This panel added ~24 words to the median campsite page and 1.2
          points to every pair, which pushed hr/zadarska/autocamp-punta ↔
          autocamp-tabor from 79.6% to 80.8% and turned the guard red.
          Almost all of those words are these: a heading, a caption
          repeated three times, and a link label. They are the template,
          not a statement about either campsite, and counting them
          measures the wrong thing — the guard's comment says so, naming
          this very pair.

          What is NOT marked: the camera's name, its distance, the
          direction it looks and when it last reported. Those vary with
          the subject, which is exactly what the guard exists to read. */}
      {/* 🔴 AN h2, AND THE PREVIOUS h3 WAS A DEFECT NO TEST COULD SEE.
          Found by opening the page — CAMP-190's own acceptance criterion,
          which I skipped before merging.

          This section is a direct child of <main>, a sibling of "Bathing
          water", "Air quality" and "Weather on site", all of which are
          h2. An h3 here made the document outline read

            … h2 Air quality → h3 Webcams nearby → h2 Weather on site

          so the webcams were a SUBSECTION OF THE AIR QUALITY, which they
          are not. On a site whose entire acquisition is organic search,
          the heading outline is how a page states its subjects — and a
          screen reader is told the same wrong thing.

          It looked worse than it read: a small uppercase label inside a
          bordered box beneath the air-quality card, which is a footnote
          attached to that card rather than a subject of its own. */}
      <h2
        id="webcams-heading"
        data-boilerplate="webcam-heading"
        className="text-xl font-bold md:text-[25px]"
      >
        Webcams nearby
      </h2>

      {/* The card, matching the two panels above it. */}
      <div className="mt-3 rounded-card border border-line-2 bg-surface-2 p-4 text-sm text-ink-2">
      {cams.length === 0 ? (
        // 🔴 TWO SENTENCES, BECAUSE THE PANEL IS EMPTY FOR TWO REASONS —
        // see `absence` in lib/webcams.ts. The first blames nobody; the
        // second blames US, which is the honest half and the one this
        // panel used to get wrong on every page 25 hours after an
        // import.
        //
        // Both carry `data-boilerplate`: each is word for word the same
        // on every page that is in that state, which is the rule.
        why === 'stale' ? (
          <p className="mt-2" data-boilerplate="webcam-stale">
            We have cameras listed near this campsite, but none of them has
            reported for more than a day. That is how old our last reading of
            them is, not a statement about the place.
          </p>
        ) : (
          <p className="mt-2" data-boilerplate="webcam-none">
            No public webcam within {distance(WEBCAM_RADIUS_M)} of this campsite. That is
            what the camera network covers, not a statement about the place.
          </p>
        )
      ) : (
        <>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cams.map((cam) => {
              const mins = reportedMinutesAgo(cam.lastFrameAt, now);
              const dir = direction(cam.title);
              return (
                <li key={cam.ref} className="rounded border border-line-2 bg-surface-2 p-2">
                  <a
                    href={cam.detailUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="block"
                  >
                    {/* 🔴 The DAYLIGHT frame, always — see lib/webcams.ts.
                        The current frame after sunset is a flat grey
                        rectangle, measured; a grey rectangle reads as a
                        broken site rather than as nightfall.

                        Plain <img>, no next/image: the bytes are Windy's
                        and must be served from their CDN under their
                        terms, not copied through ours. Width and height
                        are the API's published preview size, so the card
                        does not jump while it loads. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={frameUrl(cam.ref)}
                      alt={`The most recent daylight view from the ${shortTitle(cam.title)} webcam`}
                      width={400}
                      height={224}
                      loading="lazy"
                      className="h-auto w-full rounded"
                    />
                  </a>
                  <p className="mt-2 font-semibold text-heading">
                    {shortTitle(cam.title)}
                  </p>
                  <p className="mt-0.5">
                    {distance(cam.metres)} away
                    {dir ? ` · looking ${dir}` : ''}
                    {mins === null ? '' : ` · ${reportedPhrase(mins)}`}
                  </p>
                  {/* 🔴 The most recent DAYLIGHT view, said plainly and
                      without a time. The API gives a timestamp for the
                      camera, not for this frame, so putting a clock on
                      the picture would be inventing one. */}
                  <p className="mt-0.5 text-xs" data-boilerplate="webcam-frame-note">
                    The most recent daylight view.
                  </p>
                  {cam.providerUrl && (
                    <p className="mt-0.5 text-xs">
                      {/* They do not ask for this. The camera is the
                          operator's, not Windy's, and saying so costs a
                          line. */}
                      <a
                        href={cam.providerUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                        data-boilerplate="webcam-operator"
                        className="underline"
                      >
                        operator&rsquo;s own site
                      </a>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-xs" data-boilerplate="webcam-credit">
            {/* The credit their terms dictate, word for word, and the
                sentence that keeps the pictures honest. */}
            {WINDY_CREDIT}. Distances are straight-line from this campsite —
            a camera is not a view of the site itself.
          </p>
        </>
      )}
      </div>
    </section>
  );
}
