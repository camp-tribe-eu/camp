// CAMP-144: how wrong is the matching rule? Ask something it never read.
//
// 🔴 The rule that links two campsites uses the NAME and the DISTANCE.
// So the name and the distance cannot be used to check it. Twice on this
// card a measurement confirmed itself — once because "Camping " is
// exactly eight characters, once because Postgres's `least()` swallows
// the NULL that the split was being made on — and both times the answer
// came out confident and wrong.
//
// A website is written by a different hand. An OSM mapper types it into
// `contact:website`; a French tourist office publishes it in its own
// register. Neither consulted the other, and neither is looking at the
// campsite's name when they do it. If both say `camping-du-lac.fr`, the
// two rows are one business. If they say different domains, either the
// link is wrong or one source is listing an agency — and a person has to
// look at which.
//
// That asymmetry is why the number this produces is an UPPER BOUND on
// the error rate and is reported as one, never as "the error rate".
//
// 🔴 AND THE UPPER BOUND HAS A CONTROL GROUP, so it can be read.
//
// Measured 28.09.2026 over the 2 986 links, by distance band:
//
//       0– 25 m   487 links   311 judgeable   21.2% disagree
//      25– 50 m   625 links   419 judgeable   18.1%
//      50–100 m  1132 links   814 judgeable   19.3%
//     100–150 m   736 links   567 judgeable   15.3%
//
// The 0–25 m band is the control. Two records of a campsite 25 m apart
// with the same name are as close to certainly-one-place as this data
// gets — and they disagree about the domain MORE often than the links
// at the loose end of the rule. So ~20% is not our error rate; it is the
// rate at which ONE French campsite is published under two domains: its
// own and its chain's, its own and the town's, `.fr` and `.com`,
// `camping-x` and `campingx`.
//
// If the rule were breaking at its loose end, this column would climb
// with distance. It falls. A hand-classification of a systematic 1-in-8
// sample of the 387 disagreements (49 pairs) found 0 that are plainly
// two different businesses and 1 uncertain — consistent with the bands.
//
// 🔴 This does not prove the links are right. It proves the website
// disagreements are not what is wrong with them, and it says where to
// look next: the 869 links where neither side names itself at all.

export type LinkEvidence = {
  /** Both sides name the same domain. */
  agree: number;
  /** Both sides name a domain, and the domains differ. */
  disagree: number;
  /** At least one side publishes no usable website. */
  noEvidence: number;
};

/**
 * Hosts that say where a page is hosted, not whose business it is.
 *
 * 🔴 These are excluded from the measurement, and the reason is not
 * convenience. `jimdofree.com` on one side and the campsite's own domain
 * on the other is not two businesses disagreeing — it is one business
 * that built its site on a free host, and counting it as a disagreement
 * inflates the error rate with cases that contain no information at all.
 * Measured on the 28.09.2026 run: 31 of 436 disagreeing links had a host
 * from this list on one side.
 *
 * 🔴 What is NOT in this list, deliberately: chain operators
 * (capfun.com, yellohvillage.fr, sandaya.fr, campingcarpark.com) and
 * town or tourist-office domains. Those DO identify a business, they
 * are simply not always the same business as the campsite, and dropping
 * them would be tuning the check until it agrees with the rule it is
 * supposed to be checking. They stay in, and the hand-check below is
 * what tells them apart.
 */
const NEUTRAL_HOSTS = new Set([
  'jimdofree.com',
  'jimdosite.com',
  'e-monsite.com',
  'site-solocal.com',
  'solocal.com',
  'wixsite.com',
  'wordpress.com',
  'blogspot.com',
  'google.com',
  'openstreetmap.org',
  'facebook.com',
  'pagesjaunes.fr',
  'free.fr',
  'orange.fr',
  'wanadoo.fr',
  'gmail.com',
  'hotmail.com',
  'hotmail.fr',
  'yahoo.fr',
  'yahoo.com',
  'outlook.com',
  'outlook.fr',
  'laposte.net',
  'sfr.fr',
  'live.fr',
  'aol.com',
  'gmx.de',
  'web.de',
  't-online.de',
]);

/**
 * The registrable-ish domain of a URL, or null.
 *
 * 🔴 Crude, and crude in the safe direction. Keeping the last two labels
 * makes `www.camping-x.fr` and `reservation.camping-x.fr` agree, which
 * is right — they are one business. It does NOT understand `co.uk`, and
 * would call two different British sites the same; the links this
 * measures are 98% French, where no such second level exists, and the
 * check is reported as an upper bound anyway. Anything unparseable
 * returns null and is EXCLUDED from the measurement rather than counted
 * as agreement, because an optimistic default is how a check stops
 * checking.
 */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    ).hostname.toLowerCase();
    const labels = host
      .replace(/^www\./, '')
      .split('.')
      .filter(Boolean);
    if (labels.length < 2) return null;
    const domain = labels.slice(-2).join('.');
    return NEUTRAL_HOSTS.has(domain) ? null : domain;
  } catch {
    return null;
  }
}

/**
 * The domain behind an email address, or null.
 *
 * 🔴 A second axis, because OSM carries an email for 1 565 of these
 * campsites and DATAtourisme carries none — so for a pair where OSM has
 * only an email and the other side only a website, the website check
 * alone would report "no evidence" on 1 437 pairs that in fact hold
 * some. `info@col-ibardin.com` against `col-ibardin.com` is the same
 * business saying so twice, through two channels.
 */
export function domainOfEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return null;
  return domainOf(email.trim().slice(at + 1));
}

/** Everything one row says about who it is, as domains. */
export function identityDomains(row: {
  website?: string | null;
  email?: string | null;
}): Set<string> {
  const out = new Set<string>();
  const w = domainOf(row.website);
  if (w) out.add(w);
  const e = domainOfEmail(row.email);
  if (e) out.add(e);
  return out;
}

/**
 * Tally agreement across pairs.
 *
 * 🔴 Agreement is ANY shared domain, disagreement is "both sides named
 * themselves and shared nothing". A campsite whose OSM row gives
 * `camping-x.fr` and whose DATAtourisme row gives `camping-x.fr` plus a
 * booking agent is still the same campsite.
 */
export function judgeByIdentity(
  rows: {
    aWebsite: string | null;
    aEmail?: string | null;
    bWebsite: string | null;
    bEmail?: string | null;
  }[],
): LinkEvidence {
  const out: LinkEvidence = { agree: 0, disagree: 0, noEvidence: 0 };
  for (const r of rows) {
    const a = identityDomains({ website: r.aWebsite, email: r.aEmail });
    const b = identityDomains({ website: r.bWebsite, email: r.bEmail });
    if (a.size === 0 || b.size === 0) out.noEvidence++;
    else if ([...a].some((d) => b.has(d))) out.agree++;
    else out.disagree++;
  }
  return out;
}

/** The website-only form, kept for callers that have no email to hand. */
export function judgeByWebsite(
  rows: { aUrl: string | null; bUrl: string | null }[],
): LinkEvidence {
  return judgeByIdentity(
    rows.map((r) => ({ aWebsite: r.aUrl, bWebsite: r.bUrl })),
  );
}

/**
 * The upper bound, as a percentage, or null when nothing could be judged.
 *
 * 🔴 Null rather than 0. "No pair carried evidence" and "no pair
 * disagreed" are opposite facts and a checker that prints 0.0% for both
 * is lying about the second one.
 */
export function upperBoundPercent(e: LinkEvidence): number | null {
  const judged = e.agree + e.disagree;
  if (judged === 0) return null;
  return (e.disagree / judged) * 100;
}
