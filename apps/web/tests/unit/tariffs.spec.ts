import { expect, test } from '@playwright/test';
import {
  describeTariff,
  displayableTariffs,
  formatAmount,
  formatPeriod,
  formatPrice,
  groupTariffs,
  hasValidityPeriod,
  humaniseToken,
  isRenderableTariff,
  modeLabel,
  offerLabel,
  tariffStatus,
  type Tariff,
} from '../../src/lib/tariffs';

// CAMP-147 — the rule these tests exist to hold down:
//
//   "Showing 'from €X' with no validity period is forbidden. A
//    01.04–30.10.2026 tariff shown in November is not a price, it is
//    history, and the reader will conclude we lie."
//
// Everything below is a way that rule could quietly stop being true.

const tariff = (over: Partial<Tariff> = {}): Tariff => ({
  offer: 'BarePitch',
  mode: 'Overnight',
  policy: 'BaseRateFullRate',
  minPrice: '18.00',
  maxPrice: '25.00',
  currency: 'EUR',
  validFrom: '2026-04-01',
  validUntil: '2026-09-26',
  label: null,
  labelLang: null,
  sourceUpdatedAt: '2026-08-31',
  sourceId: 'datatourisme',
  ...over,
});

test.describe('a price without a season never reaches the page', () => {
  test('a tariff with neither date is refused', () => {
    // 🔴 The whole card in one assertion. The API filters these in SQL;
    // this is the second, independent lock, because the API is one
    // query in one service and this is the last thing before the screen.
    const undated = tariff({ validFrom: null, validUntil: null });
    expect(hasValidityPeriod(undated)).toBe(false);
    expect(displayableTariffs([undated])).toEqual([]);
  });

  test('one end of the season is enough to date a price', () => {
    expect(hasValidityPeriod(tariff({ validUntil: null }))).toBe(true);
    expect(hasValidityPeriod(tariff({ validFrom: null }))).toBe(true);
  });

  test('a malformed date does not count as a season', () => {
    // "01/04/2026" is a date to a human and nothing to Date.parse in a
    // way we can trust. It must not license a price.
    expect(
      hasValidityPeriod(tariff({ validFrom: '01/04/2026', validUntil: null })),
    ).toBe(false);
  });

  test('an undated tariff is dropped by grouping, not merely unlabelled', () => {
    const groups = groupTariffs(
      [tariff(), tariff({ validFrom: null, validUntil: null })],
      new Date('2026-05-01T00:00:00Z'),
    );
    expect(groups.current.length + groups.expired.length).toBe(1);
  });

  test('a row is drawn whole or not at all', () => {
    // 🔴 Both halves, and the period half exists only because mutation
    // testing found it unreachable through the component: the grouping
    // step removes anything `formatPeriod` would refuse, so deleting
    // that check broke no test. Asserted here, where it is reachable.
    expect(isRenderableTariff(tariff())).toBe(true);
    // A season that matches the shape of a date and is not one.
    expect(
      isRenderableTariff(tariff({ validFrom: '01/04/2026', validUntil: null })),
    ).toBe(false);
    // A period with no amount beside it — the API refuses this, and the
    // page is the last place that can.
    expect(
      isRenderableTariff(tariff({ minPrice: null, maxPrice: null })),
    ).toBe(false);
  });

  test('formatPeriod never returns an empty string', () => {
    // The component drops a row whose period will not render. If this
    // returned '' instead of null the row would render as a price with
    // a blank beside it — the forbidden thing, arrived at by accident.
    expect(formatPeriod(tariff({ validFrom: null, validUntil: null }))).toBeNull();
  });
});

test.describe('an expired season is said out loud', () => {
  const november = new Date('2026-11-15T00:00:00Z');

  test('a season that ended is expired', () => {
    expect(tariffStatus(tariff(), november)).toBe('expired');
  });

  test('the last day of the season is still current', () => {
    // 🔴 validUntil is INCLUSIVE. Treating it as exclusive prints "this
    // price has expired" on the day it is still being charged.
    expect(
      tariffStatus(tariff(), new Date('2026-09-26T00:00:00Z')),
    ).toBe('current');
  });

  test('the day after the season is expired', () => {
    expect(
      tariffStatus(tariff(), new Date('2026-09-27T00:00:00Z')),
    ).toBe('expired');
  });

  test('a season that has not started yet is upcoming, not expired', () => {
    expect(
      tariffStatus(tariff(), new Date('2026-02-01T00:00:00Z')),
    ).toBe('upcoming');
  });

  test('grouping keeps expired tariffs rather than hiding them', () => {
    // 🔴 435 of the 1 200 pages that show a price have nothing but
    // expired seasons. Hiding them would make those pages identical to
    // the 57 236 with no price at all, and lose the one useful thing we
    // could say to that reader.
    const groups = groupTariffs([tariff()], november);
    expect(groups.current).toEqual([]);
    expect(groups.expired).toHaveLength(1);
  });

  test('an open-ended season is current forever, which is what it says', () => {
    expect(
      tariffStatus(tariff({ validUntil: null }), november),
    ).toBe('current');
  });

  test('🔴 only the LAST ended season is shown, and the rest are counted', () => {
    // Found by opening a real page. Camping Le Beaulieu prices week by
    // week: 79 tariffs, 65 of them from seasons that ended in July, and
    // the panel rendered 7 315 pixels tall — a metre and a half of last
    // summer, burying everything below it. The last ended season says
    // what a reader needs; the 64 before it say nothing extra.
    const groups = groupTariffs(
      [
        tariff({ validFrom: '2026-07-04', validUntil: '2026-07-10', minPrice: '29.00' }),
        tariff({ validFrom: '2026-07-04', validUntil: '2026-07-10', minPrice: '49.00' }),
        tariff({ validFrom: '2026-05-25', validUntil: '2026-07-03' }),
        tariff({ validFrom: '2026-04-01', validUntil: '2026-05-24' }),
      ],
      november,
    );
    expect(groups.current).toEqual([]);
    expect(groups.expired).toHaveLength(2);
    expect(groups.expired.every((t) => t.validUntil === '2026-07-10')).toBe(true);
    // 🔴 Counted, not silently dropped. Editing somebody's price list
    // without saying so is the same failure as showing it undated.
    expect(groups.olderExpired).toBe(2);
  });

  test('nothing is counted as older when there is one ended season', () => {
    const groups = groupTariffs([tariff()], november);
    expect(groups.expired).toHaveLength(1);
    expect(groups.olderExpired).toBe(0);
  });

  test('current seasons are never thinned, however many there are', () => {
    // The trimming applies to history only. A campsite with fourteen
    // current tariffs — the measured maximum — shows fourteen.
    const many = Array.from({ length: 14 }, (_, i) =>
      tariff({ minPrice: `${10 + i}.00`, validUntil: '2099-12-31' }),
    );
    const groups = groupTariffs(many, november);
    expect(groups.current).toHaveLength(14);
    expect(groups.olderExpired).toBe(0);
  });
});

test.describe('amounts are printed exactly as stored', () => {
  test('no float round-trip', () => {
    // 🔴 The feed itself contains "2.7999999523162841796875" because
    // somebody upstream put 2.80 through a 32-bit float. Nothing here
    // may call Number().
    expect(formatAmount('13.50', 'EUR')).toBe('€13.50');
    expect(formatAmount('47.00', 'EUR')).toBe('€47');
    expect(formatAmount('0.66', 'EUR')).toBe('€0.66');
  });

  test('a range names the currency once', () => {
    expect(formatPrice(tariff())).toBe('€18–25');
  });

  test('min equal to max is one price, not a range', () => {
    expect(formatPrice(tariff({ minPrice: '13.50', maxPrice: '13.50' }))).toBe(
      '€13.50',
    );
  });

  test('a floor alone says "from", a ceiling alone says "up to"', () => {
    expect(formatPrice(tariff({ maxPrice: null }))).toBe('from €18');
    expect(formatPrice(tariff({ minPrice: null }))).toBe('up to €25');
  });

  test('a non-euro currency is named rather than assumed', () => {
    expect(formatAmount('18.00', 'CHF')).toBe('18 CHF');
    expect(
      formatPrice(tariff({ currency: 'CHF' })),
    ).toBe('18–25 CHF');
  });

  test('a tariff with no amount produces null, never a bare symbol', () => {
    expect(formatPrice(tariff({ minPrice: null, maxPrice: null }))).toBeNull();
  });
});

test.describe('the publisher’s vocabulary, not ours', () => {
  test('known tokens use DATAtourisme’s own English', () => {
    expect(offerLabel('BarePitch')).toBe('Bare pitch');
    expect(offerLabel('CamperPitch')).toBe('Motorhome pitch');
    expect(modeLabel('Overnight')).toBe('per night');
  });

  test('an unknown token is made readable, never dropped', () => {
    // 🔴 Dropped is the tempting choice and the wrong one: the feed is
    // somebody else's and will grow a 52nd token without telling us. A
    // row that silently vanishes is invisible; an imperfect label is a
    // bug report.
    expect(humaniseToken('GlampingPod')).toBe('Glamping pod');
    expect(offerLabel('GlampingPod')).toBe('Glamping pod');
    expect(offerLabel(null)).toBeNull();
  });

  test('a tariff naming neither what nor how still describes itself', () => {
    // 9 425 of the 13 122 stored tariff lines name no offer at all. An
    // empty cell in the "What" column is not an option.
    expect(describeTariff(tariff({ offer: null, mode: null }))).toBe('Stay');
    expect(
      describeTariff(tariff({ offer: null, mode: null, policy: 'ChildRate' })),
    ).toBe('Child rate');
  });

  test('what and how are joined into one phrase', () => {
    expect(describeTariff(tariff())).toBe('Bare pitch, per night');
  });
});

test.describe('the season reads like a calendar', () => {
  test('both ends', () => {
    expect(formatPeriod(tariff())).toBe('1 Apr 2026 – 26 Sep 2026');
  });

  test('one end', () => {
    expect(formatPeriod(tariff({ validUntil: null }))).toBe('from 1 Apr 2026');
    expect(formatPeriod(tariff({ validFrom: null }))).toBe('until 26 Sep 2026');
  });
});
