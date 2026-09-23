import { CONTACT_EMAIL } from '@/lib/legal';
import { SITE } from '@/lib/sitemap';

// CAMP-56: security.txt — RFC 9116.
//
// 🔴 Real risk reduction, not a formality. A researcher who finds a hole
// and cannot find anywhere to report it does one of two things: gives up,
// or publishes. The second is how a quiet fix becomes an incident, and
// the cost of preventing it is this file. It is the first place anyone
// looks, and it is a documented standard rather than a convention we
// invented.
//
// 🔴 `Expires` is REQUIRED by the RFC and must be in the future, which
// makes a hardcoded date a trap: it would silently become an invalid file
// the day it passed. It is computed at build time instead, and the site
// already rebuilds every week when the OSM import runs (CAMP-28), so it
// can only go stale if we have stopped deploying entirely — at which
// point a stale contact file is not the biggest problem. A test asserts
// the date is still ahead.

export const dynamic = 'force-static';

/** Half a year from the build, well inside the RFC's one-year ceiling. */
const VALID_DAYS = 182;

export function GET() {
  const expires = new Date(Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000);

  const body = [
    '# CampTribe — how to report a security problem.',
    '#',
    '# Write to us before publishing. We will confirm receipt, keep you',
    '# informed, and credit you if you want to be credited.',
    '',
    `Contact: mailto:${CONTACT_EMAIL}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en, uk, nl',
    `Canonical: ${SITE}/.well-known/security.txt`,
    `Policy: ${SITE}/legal/terms`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
