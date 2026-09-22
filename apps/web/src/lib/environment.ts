// CAMP-90: is this build meant to be found by search engines?
//
// 🔴 One flag, read in exactly one place, and it drives everything:
// robots.txt, the site-wide meta robots, the `X-Robots-Tag` header, and
// what the pre-launch checker asserts. Three separate mechanisms that
// each look right on their own are how a site ends up half-closed —
// robots.txt blocking the crawler that would have read the `noindex` it
// needed to see.
//
// 🔴 The default is CLOSED, deliberately.
//
// Both mistakes are expensive, but they are not symmetric. Shipping a
// half-built site into the index means months of waiting for a recrawl,
// and for a project whose entire acquisition is organic, a bad first
// impression costs more than any bug. Shipping production accidentally
// closed is loud, noticed in days, and fixed by flipping one variable.
// So a missing or misspelled variable must land on the safe side.
//
// The opposite risk — `noindex` surviving into the real launch, which
// is the classic way sites vanish from the index — is not handled by a
// default. It is handled by `scripts/seo/check-indexing.mjs`, which is
// told which mode to expect and fails when the build disagrees.

export type SiteMode = 'public' | 'closed';

/**
 * `NEXT_PUBLIC_SITE_MODE=public` opts a build into being indexable.
 * Anything else — unset, empty, a typo — is treated as closed.
 */
export const SITE_MODE: SiteMode =
  process.env.NEXT_PUBLIC_SITE_MODE === 'public' ? 'public' : 'closed';

export const isPublic = SITE_MODE === 'public';

/** What every page and every file should tell a crawler in this mode. */
export const ROBOTS_DIRECTIVE = isPublic ? 'index, follow' : 'noindex, nofollow';
