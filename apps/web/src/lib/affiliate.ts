// CAMP-4 / CAMP-54: the seam a commission link will one day pass through.
//
// 🔴 WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT.
//
// Camper rental is the project's primary monetisation route. It is also
// the part of the project we cannot build yet: the applications to the
// affiliate networks are the owner's card (CAMP-98) and they are not
// done, so today there is no tracking id, no programme, no offer and no
// destination URL anywhere in this repository.
//
// So this file builds the SEAM rather than the offer. Everything that
// varies per account — the publisher id, which network is on — comes
// from environment variables read at build time and absent by default.
// With nothing configured, `offersFor()` returns an empty array and the
// pages render a truthful empty state. There is no fallback, no sample
// offer and no "from €69/day": a plausible number nobody measured is the
// single most expensive thing this project can publish.
//
// 🔴 It is also NOT a feed integration, and that is an architecture
// decision already taken rather than a gap. Batch synchronisation of
// partner inventory through network APIs costs weeks and earns nothing
// at a stage with no traffic; plain tracking links in editorial content
// cost a day. API integration is earned by traffic. The same reasoning
// is already written into apps/api/src/entities/rental.entity.ts, which
// stores dimensions and licence classes and explicitly stores no prices.
//
// ───────────────────────────────────────────────────────────────────────
// 🔴 THE OWNER'S STEP AFTER CAMP-98 — one line per network, no code.
//
//   AFFILIATE_AWIN_ID=<your Awin publisher id>          Awin, 4–7%
//   AFFILIATE_IMPACT_ID=<your Impact partner id>        Impact, €25–60/rental
//   AFFILIATE_CJ_ID=<your CJ publisher (PID)>           CJ Affiliate
//   AFFILIATE_BOOKING_AID=<your Booking.com AID>        Booking.com
//   AFFILIATE_ACSI_ID=<your ACSI partner id>            ACSI, €10–15/lead
//
// Put them in the build environment (Cloudflare Pages → Settings →
// Environment variables, or apps/web/.env.local for a local build) and
// rebuild. Nothing else changes: no file in this repository has to be
// edited to turn a network ON.
//
// ⚠️ NONE of these carry the `NEXT_PUBLIC_` prefix, on purpose. They are
// read here, in a server component, at build time, and only the finished
// link reaches the browser. The repository camp-tribe-eu/camp is PUBLIC;
// an affiliate id is configuration and never source.
//
// The second half — WHICH partner appears on WHICH page — is editorial,
// not secret, and lives in src/data/rental/placements.json. It is an
// empty list today for the reason at the top of this comment.

/** The networks in scope, in the order the owner will apply to them. */
export type NetworkId = 'awin' | 'impact' | 'cj' | 'booking' | 'acsi';

/**
 * How a link for this network is made.
 *
 * 🔴 Three strategies rather than one, because the networks genuinely
 * differ and pretending otherwise is how a link silently stops tracking:
 * the click still works, the reader still books, and the commission goes
 * to nobody. A link that half-works is worse than no link, because
 * nothing about the page looks broken.
 */
export type LinkStrategy =
  /** We build the whole URL from documented parameters. */
  | 'compose'
  /** The network issues the URL; we append our own attribution parameter. */
  | 'append-subid'
  /** We use the URL exactly as issued and append nothing. */
  | 'as-issued';

/**
 * How sure we are about the format below.
 *
 * `documented` — the format is in the network's public documentation and
 * is the one every publisher uses.
 * `unconfirmed` — plausible and widely quoted, but not something we have
 * read in OUR account's dashboard. A link built on an unconfirmed format
 * is exactly the half-working link described above, so these stay on
 * `as-issued` until the owner confirms them.
 */
export type Confidence = 'documented' | 'unconfirmed';

export interface Network {
  id: NetworkId;
  /** What a reader sees if the page ever names the network. */
  name: string;
  /** The network's own site. For the owner; never rendered to a reader. */
  home: string;
  /** 🔴 THE variable that turns this network on. One per network. */
  envVar: string;
  /** What that variable holds, in the network's own vocabulary. */
  idMeaning: string;
  strategy: LinkStrategy;
  /** The query parameter our own attribution rides on, where there is one. */
  subIdParam: string | null;
  confidence: Confidence;
  /** How the owner is paid. From the card; never rendered to a reader. */
  commission: string;
}

export const NETWORKS: Record<NetworkId, Network> = {
  awin: {
    id: 'awin',
    name: 'Awin',
    home: 'https://www.awin.com/',
    envVar: 'AFFILIATE_AWIN_ID',
    idMeaning: 'publisher id (awinaffid)',
    // Awin's redirector takes the destination as a parameter, which means
    // we can point a link at any page of the advertiser's site rather
    // than only at its home page — the difference between sending a
    // reader to a German fleet page and dumping them on a landing page.
    strategy: 'compose',
    subIdParam: 'clickref',
    confidence: 'documented',
    commission: '4–7% of the rental',
  },
  impact: {
    id: 'impact',
    name: 'Impact.com',
    home: 'https://impact.com/',
    envVar: 'AFFILIATE_IMPACT_ID',
    idMeaning: 'partner id, as it appears in the tracking link',
    // Impact issues a per-campaign short link on its own domain. There is
    // nothing for us to compose: the campaign and ad ids are in the link
    // the dashboard hands over.
    strategy: 'append-subid',
    subIdParam: 'subId1',
    confidence: 'documented',
    commission: '€25–60 per completed rental',
  },
  cj: {
    id: 'cj',
    name: 'CJ Affiliate',
    home: 'https://www.cj.com/',
    envVar: 'AFFILIATE_CJ_ID',
    idMeaning: 'publisher id (PID)',
    strategy: 'append-subid',
    subIdParam: 'sid',
    confidence: 'documented',
    commission: 'per programme',
  },
  booking: {
    id: 'booking',
    name: 'Booking.com',
    home: 'https://www.booking.com/',
    envVar: 'AFFILIATE_BOOKING_AID',
    idMeaning: 'affiliate id (aid)',
    // Booking takes `aid` and `label` on an ordinary booking.com URL, so
    // a deep link to one town's results stays a deep link.
    strategy: 'compose',
    subIdParam: 'label',
    confidence: 'documented',
    commission: 'per stay, per programme',
  },
  acsi: {
    id: 'acsi',
    name: 'ACSI',
    home: 'https://www.acsi.eu/',
    envVar: 'AFFILIATE_ACSI_ID',
    idMeaning: 'partner id, whatever the programme calls it',
    // 🔴 `as-issued`, and this is the honest setting rather than the lazy
    // one. We have not seen an ACSI tracking link, so we do not know
    // which parameter carries a sub-id — and inventing one would produce
    // a URL that looks right, works, and attributes nothing.
    //
    // OWNER: once the ACSI programme is live, read one issued link in the
    // dashboard. If it carries a sub-id parameter, set `strategy` to
    // 'append-subid', put the parameter name in `subIdParam`, and this
    // file is the only change.
    strategy: 'as-issued',
    subIdParam: null,
    confidence: 'unconfirmed',
    commission: '€10–15 per lead',
  },
};

export const NETWORK_IDS = Object.keys(NETWORKS) as NetworkId[];

/**
 * 🔴 Literal `process.env.X` accesses, not `process.env[network.envVar]`.
 *
 * Next inlines only what it can see statically. A computed lookup works
 * in a Node build and returns `undefined` in every bundling mode that
 * replaces `process.env` with a fixed object — which is the failure where
 * the site builds, the page renders, and every affiliate link quietly
 * disappears with no error anywhere. Five literal lines cost nothing and
 * cannot do that.
 */
function rawIds(): Record<NetworkId, string | undefined> {
  return {
    awin: process.env.AFFILIATE_AWIN_ID,
    impact: process.env.AFFILIATE_IMPACT_ID,
    cj: process.env.AFFILIATE_CJ_ID,
    booking: process.env.AFFILIATE_BOOKING_AID,
    acsi: process.env.AFFILIATE_ACSI_ID,
  };
}

/** The id for one network, or null when it is not configured. */
export function networkId(id: NetworkId): string | null {
  const raw = rawIds()[id];
  const value = raw?.trim();
  // An empty string is "not configured", not "configured as nothing" —
  // `AFFILIATE_AWIN_ID=` in a .env file is the shape this arrives in.
  return value ? value : null;
}

export const isConfigured = (id: NetworkId): boolean => networkId(id) !== null;

/** Which networks this build can actually link to. Empty until CAMP-98. */
export function configuredNetworks(): NetworkId[] {
  return NETWORK_IDS.filter(isConfigured);
}

// ── Placements ──────────────────────────────────────────────────────────

/**
 * One partner, on one page.
 *
 * 🔴 Kept OUT of the environment on purpose. Which advertiser we put in
 * front of a reader is an editorial claim we make on a page, and an
 * editorial claim belongs in the repository where it can be reviewed,
 * not in a deployment setting nobody reads. Only the id is configuration,
 * because only the id is per-account.
 */
export interface Placement {
  /** `hub`, or a lower-case ISO 3166-1 alpha-2 country code. */
  page: string;
  network: NetworkId;
  /** The advertiser, spelled exactly as the network spells it. */
  programme: string;
  /**
   * `compose` only. Awin's advertiser id (awinmid); unused elsewhere.
   */
  merchantId?: string;
  /** Where the reader ends up: the destination, or the issued link. */
  url: string;
  /**
   * One sentence about what this partner actually does, in our words.
   *
   * 🔴 Ours, never theirs. Copy supplied by an advertiser is advertising
   * copy, and a page that reprints it has stopped being editorial — which
   * is the whole reason a reader would trust the page in the first place.
   */
  note: string;
  /** ISO date the owner last confirmed the programme accepted us. */
  confirmedAt: string;
}

/**
 * What is wrong with a placement, in words. Empty means publishable.
 *
 * 🔴 Same shape as `publishable()` in lib/guides.ts, and for the same
 * reason: the check has to be runnable by a test over the whole file, not
 * only by a page as it renders one. A placement with a broken URL that is
 * never rendered is still a placement that will break the day it is.
 */
export function placementProblems(p: Placement): string[] {
  const problems: string[] = [];
  const where = `${p.page}/${p.programme || '(unnamed)'}`;

  if (!p.page?.trim()) problems.push('a placement with no page');
  if (!p.programme?.trim()) problems.push(`${where}: no programme name`);
  if (!p.note?.trim()) problems.push(`${where}: no note of our own`);
  if (!NETWORKS[p.network]) {
    problems.push(`${where}: unknown network "${p.network}"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.confirmedAt ?? '')) {
    problems.push(`${where}: confirmedAt is not an ISO date`);
  }

  let url: URL | null = null;
  try {
    url = new URL(p.url);
  } catch {
    problems.push(`${where}: url is not a URL`);
  }
  // 🔴 https only. A commission link is a link we PUT in front of a
  // reader; sending them to a plaintext page is our failure, not the
  // advertiser's.
  if (url && url.protocol !== 'https:') {
    problems.push(`${where}: url is not https`);
  }
  if (NETWORKS[p.network]?.strategy === 'compose' && p.network === 'awin') {
    if (!p.merchantId?.trim()) {
      problems.push(`${where}: Awin needs a merchantId (awinmid)`);
    }
  }
  // 🔴 Booking's strategy writes `aid` on to the URL ITSELF rather than on
  // to a redirector. Point that at somebody else's site and we quietly
  // hand a third party a parameter named after our affiliate account and
  // track nothing — a link that works perfectly and earns nothing, which
  // is the failure mode this whole file is arranged around.
  if (p.network === 'booking' && url) {
    const host = url.hostname.toLowerCase();
    if (host !== 'booking.com' && !host.endsWith('.booking.com')) {
      problems.push(`${where}: a Booking.com placement must point at booking.com`);
    }
  }
  return problems;
}

// ── Building the link ───────────────────────────────────────────────────

/**
 * Our own attribution value: which page sent the click.
 *
 * 🔴 Kept to the path and nothing else. Whatever we put here is handed to
 * a third party on every click, so it carries the one thing we actually
 * need — which page earns — and nothing about the reader.
 */
export function clickRef(page: string): string {
  return `camptribe-${page}`;
}

/**
 * The outbound URL for a placement, or `null` when we cannot build one.
 *
 * 🔴 `null` is the important return value. It happens whenever the
 * network has no id configured, which is EVERY placement today, and it is
 * what guarantees the pages cannot render a dead outbound link while the
 * owner is still filling in application forms.
 */
export function linkFor(p: Placement): string | null {
  const network = NETWORKS[p.network];
  if (!network) return null;

  const id = networkId(p.network);
  if (!id) return null;
  if (placementProblems(p).length > 0) return null;

  const ref = clickRef(p.page);

  switch (network.strategy) {
    case 'compose': {
      if (p.network === 'awin') {
        // https://www.awin1.com/cread.php?awinmid=…&awinaffid=…&ued=…
        const u = new URL('https://www.awin1.com/cread.php');
        u.searchParams.set('awinmid', p.merchantId as string);
        u.searchParams.set('awinaffid', id);
        u.searchParams.set('ued', p.url);
        if (network.subIdParam) u.searchParams.set(network.subIdParam, ref);
        return u.toString();
      }
      // Booking.com: the advertiser's own URL, with `aid` and `label` set
      // on it. Deep links stay deep, which is the point of doing it this
      // way rather than sending everyone to the home page.
      const u = new URL(p.url);
      u.searchParams.set('aid', id);
      if (network.subIdParam) u.searchParams.set(network.subIdParam, ref);
      return u.toString();
    }
    case 'append-subid': {
      const u = new URL(p.url);
      if (network.subIdParam) u.searchParams.set(network.subIdParam, ref);
      return u.toString();
    }
    case 'as-issued':
      return p.url;
  }
}

/** A placement resolved into something a page can render. */
export interface Offer {
  network: Network;
  programme: string;
  note: string;
  href: string;
}

/**
 * The offers for one page: `hub`, or a country code.
 *
 * Returns `[]` when nothing is configured, which is the state this ships
 * in. Callers must render an honest empty state rather than hiding the
 * section — a section that disappears teaches nobody anything, and the
 * disclosure has to be part of the template from the first day rather
 * than remembered on the day the first link is added.
 */
export function offersFor(page: string, placements: Placement[]): Offer[] {
  return placements
    .filter((p) => p.page === page)
    .map((p) => {
      const href = linkFor(p);
      return href
        ? { network: NETWORKS[p.network], programme: p.programme, note: p.note, href }
        : null;
    })
    .filter((o): o is Offer => o !== null);
}
