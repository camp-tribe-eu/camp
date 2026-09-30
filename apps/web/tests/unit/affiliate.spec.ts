import { expect, test } from '@playwright/test';
import {
  clickRef,
  linkFor,
  NETWORK_IDS,
  NETWORKS,
  offersFor,
  placementProblems,
  configuredNetworks,
  type Placement,
} from '../../src/lib/affiliate';

// CAMP-4 — the affiliate seam, tested before it has ever carried a click.
//
// 🔴 Why a thing with no accounts behind it gets a test suite.
//
// The day the owner's applications (CAMP-98) are accepted, the only
// change to this repository is five environment variables and a few lines
// in placements.json. Nobody will re-read this file that day. If the link
// builder is wrong, the site will still build, the pages will still
// render, the links will still work — and the commission will go to
// nobody, silently, for as long as it takes someone to notice revenue
// that never arrived. That is the failure these tests exist to prevent,
// and it can only be caught before the fact.

const ENV_KEYS = NETWORK_IDS.map((id) => NETWORKS[id].envVar);

/** Runs `fn` with exactly these affiliate variables set, then restores. */
function withEnv(vars: Record<string, string>, fn: () => void) {
  const before: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    before[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, vars);
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

const awin: Placement = {
  page: 'de',
  network: 'awin',
  programme: 'Test Advertiser',
  merchantId: '12345',
  url: 'https://example.com/campers?size=large',
  note: 'Our own sentence about what they do.',
  confirmedAt: '2026-09-27',
};

test('every network declares one uppercase AFFILIATE_ variable of its own', () => {
  const seen = new Set<string>();
  for (const id of NETWORK_IDS) {
    const n = NETWORKS[id];
    expect(n.envVar, `${id} has a badly named variable`).toMatch(
      /^AFFILIATE_[A-Z0-9_]+$/,
    );
    expect(seen.has(n.envVar), `${n.envVar} is used twice`).toBe(false);
    seen.add(n.envVar);
    // A network we cannot describe to the owner is a network he cannot
    // configure. Both of these end up in the comment he reads.
    expect(n.idMeaning.length, `${id} does not say what its id is`).toBeGreaterThan(5);
    expect(n.commission.length, `${id} does not say how it pays`).toBeGreaterThan(3);
  }
});

test('a network we have not confirmed a sub-id for appends nothing', () => {
  // 🔴 The honesty rule, enforced. Guessing a sub-id parameter produces a
  // URL that looks right, works, and attributes nothing — the worst of
  // the three outcomes. So `unconfirmed` must mean `as-issued`.
  for (const id of NETWORK_IDS) {
    const n = NETWORKS[id];
    if (n.confidence === 'unconfirmed') {
      expect(n.strategy, `${id} guesses at a link format`).toBe('as-issued');
      expect(n.subIdParam, `${id} invents a sub-id parameter`).toBeNull();
    }
  }
});

// ── The state this actually ships in ───────────────────────────────────

test('with nothing configured there are no networks, no links and no offers', () => {
  withEnv({}, () => {
    expect(configuredNetworks()).toEqual([]);
    // 🔴 The single most important assertion in this file. A page must
    // not be able to render a dead outbound link while the owner is still
    // filling in application forms.
    expect(linkFor(awin)).toBeNull();
    expect(offersFor('de', [awin])).toEqual([]);
  });
});

test('an empty variable is not configured, which is how a .env line arrives', () => {
  withEnv({ AFFILIATE_AWIN_ID: '   ' }, () => {
    expect(configuredNetworks()).toEqual([]);
    expect(linkFor(awin)).toBeNull();
  });
});

// ── Link building, per network ─────────────────────────────────────────

test('Awin composes its redirector and encodes the destination', () => {
  withEnv({ AFFILIATE_AWIN_ID: 'AFF777' }, () => {
    const href = linkFor(awin);
    expect(href).not.toBeNull();
    const u = new URL(href as string);
    expect(u.origin + u.pathname).toBe('https://www.awin1.com/cread.php');
    expect(u.searchParams.get('awinmid')).toBe('12345');
    expect(u.searchParams.get('awinaffid')).toBe('AFF777');
    // 🔴 The destination must survive intact, query string included. Built
    // by string concatenation this is where the advertiser's own `?size=`
    // silently becomes a parameter of the redirector instead.
    expect(u.searchParams.get('ued')).toBe('https://example.com/campers?size=large');
    expect(u.searchParams.get('clickref')).toBe(clickRef('de'));
  });
});

test('Booking keeps the deep link and sets aid and label on it', () => {
  withEnv({ AFFILIATE_BOOKING_AID: '999888' }, () => {
    const href = linkFor({
      ...awin,
      network: 'booking',
      merchantId: undefined,
      url: 'https://www.booking.com/searchresults.html?dest_id=-1746443',
    });
    const u = new URL(href as string);
    expect(u.hostname).toBe('www.booking.com');
    expect(u.searchParams.get('dest_id')).toBe('-1746443');
    expect(u.searchParams.get('aid')).toBe('999888');
    expect(u.searchParams.get('label')).toBe(clickRef('de'));
  });
});

test('Impact and CJ append their sub-id and change nothing else', () => {
  withEnv({ AFFILIATE_IMPACT_ID: 'i-1', AFFILIATE_CJ_ID: 'cj-1' }, () => {
    const impact = new URL(
      linkFor({
        ...awin,
        network: 'impact',
        merchantId: undefined,
        url: 'https://imp.example.net/c/1/2/3',
      }) as string,
    );
    expect(impact.pathname).toBe('/c/1/2/3');
    expect(impact.searchParams.get('subId1')).toBe(clickRef('de'));

    const cj = new URL(
      linkFor({
        ...awin,
        network: 'cj',
        merchantId: undefined,
        url: 'https://www.example.net/click-1-2',
      }) as string,
    );
    expect(cj.searchParams.get('sid')).toBe(clickRef('de'));
  });
});

test('ACSI is used exactly as issued', () => {
  withEnv({ AFFILIATE_ACSI_ID: 'acsi-1' }, () => {
    const url = 'https://www.example.eu/partner/abc?x=1';
    expect(
      linkFor({ ...awin, network: 'acsi', merchantId: undefined, url }),
    ).toBe(url);
  });
});

test('one network being configured does not switch on another', () => {
  withEnv({ AFFILIATE_AWIN_ID: 'AFF777' }, () => {
    expect(configuredNetworks()).toEqual(['awin']);
    expect(
      linkFor({ ...awin, network: 'cj', merchantId: undefined }),
    ).toBeNull();
  });
});

// ── Refusing a bad placement ───────────────────────────────────────────

test('a broken placement is refused rather than rendered', () => {
  withEnv({ AFFILIATE_AWIN_ID: 'AFF777' }, () => {
    const http = { ...awin, url: 'http://example.com/x' };
    expect(placementProblems(http).join(' ')).toContain('not https');
    expect(linkFor(http), 'a refused placement must not produce a link').toBeNull();

    expect(
      placementProblems({ ...awin, merchantId: undefined }).join(' '),
    ).toContain('merchantId');

    expect(placementProblems({ ...awin, confirmedAt: 'last week' }).join(' ')).toContain(
      'ISO date',
    );

    expect(placementProblems({ ...awin, note: '' }).join(' ')).toContain(
      'no note of our own',
    );

    expect(
      placementProblems({
        ...awin,
        network: 'nosuch' as Placement['network'],
      }).join(' '),
    ).toContain('unknown network');
  });
});

test('a Booking placement pointing somewhere else is refused', () => {
  // 🔴 `aid` is written on to the destination URL itself, so a Booking
  // placement aimed at another host would hand a stranger a parameter
  // named after our account and track nothing. The subdomain check has to
  // be on the host structure, not on a substring — `booking.com.evil.test`
  // passes a `.includes('booking.com')` test.
  const stray: Placement = {
    ...awin,
    network: 'booking',
    merchantId: undefined,
    url: 'https://booking.com.evil.test/x',
  };
  expect(placementProblems(stray).join(' ')).toContain('must point at booking.com');

  const good: Placement = {
    ...awin,
    network: 'booking',
    merchantId: undefined,
    url: 'https://www.booking.com/searchresults.html',
  };
  expect(placementProblems(good)).toEqual([]);
});

test('a valid placement has nothing to complain about', () => {
  expect(placementProblems(awin)).toEqual([]);
});
