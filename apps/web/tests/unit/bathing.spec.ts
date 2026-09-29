import { expect, test } from '@playwright/test';
import {
  allCopy,
  BATHING_ATTRIBUTION,
  BATHING_RADIUS_M,
  BATHING_SEASON,
  BATHING_FRESHNESS,
  BATHING_SOURCE_ID,
  BATHING_STATUS_LABEL,
  categoryLabel,
  isClassified,
  noBathingWaterSentence,
  notClassifiedSentence,
  seasonContextSentence,
  seasonLabel,
  seasonSentence,
  statusLabel,
  type BathingWater,
} from '../../src/lib/bathing';
import { findForbiddenWords, FORBIDDEN_WORDS } from '../../src/lib/wording';
import { shouldFlagStale, SOURCES } from '../../src/lib/sources';
import { BATHING_RADIUS_M as API_RADIUS_M } from '../../../api/src/bathing/nearby';
import {
  BATHING_ATTRIBUTION as API_ATTRIBUTION,
  BATHING_SEASON as API_SEASON,
} from '../../../api/src/bathing/source';

// CAMP-168 — the rules about what this page may say, checked against the
// strings themselves. The same rules are checked again in
// tests/e2e/bathing-water.spec.ts against the SERVED HTML, because a
// rule verified only against the function that generates the text is one
// the next hard-coded sentence walks straight past.

const bw = (over: Partial<BathingWater> = {}): BathingWater => ({
  ref: 'FRP01000001',
  name: 'PLAGE DU SILLON',
  category: 'Coastal',
  season: 2025,
  status: 'excellent',
  profileUrl: 'https://baignades.sante.gouv.fr/x',
  metres: 640,
  sourceId: BATHING_SOURCE_ID,
  ...over,
});

test.describe('the season is never dropped', () => {
  // 🔴 THE CARD'S ONE RED LINE. Every sentence this module can produce
  // about a classification names the year.
  test('every sentence about a classification carries the year', () => {
    const w = bw();
    for (const s of [
      seasonSentence(w),
      notClassifiedSentence(w),
      seasonContextSentence(w.season),
      seasonLabel(2025),
    ]) {
      expect(s, s).toContain('2025');
    }
  });

  test('the season phrase says it is a season, not a date', () => {
    expect(seasonLabel(2025)).toBe('2025 bathing season');
  });

  test('the sentence says the class describes a season, not a day', () => {
    expect(seasonContextSentence(2025)).toContain('whole bathing season');
    expect(seasonContextSentence(2025)).toContain('rather than a particular day');
    expect(seasonContextSentence(2025)).toContain('2025');
  });

  // 🔴 THE ONE THE BROWSER FOUND AND THE SUITE DID NOT.
  //
  // The first version printed "Classified by the national authorities
  // for the 2025 bathing season" under every record, including the ones
  // whose class IS "Not classified" — so the page said both, two lines
  // apart. Each string was true on its own, which is exactly why no
  // assertion about strings caught it.
  test('an unclassified site is never also described as classified', () => {
    const w = bw({ status: 'not_classified' });
    const rendered = [notClassifiedSentence(w), seasonContextSentence(w.season)];
    for (const s of rendered) {
      expect(s, s).not.toMatch(/\bClassified by\b/);
    }
  });

  test('a classified site still says who classified it', () => {
    expect(seasonSentence(bw())).toMatch(/Classified by the national authorities/);
  });

  // 🔴 THE OTHER DIRECTION. The test above asserts only that an
  // unclassified site is not described as classified. Nothing asserted
  // that a classified site is not described as unclassified — so the
  // component could print `notClassifiedSentence` for every record and
  // every classified page would say "Excellent" and, two lines below,
  // that the authorities published no classification.
  test('a classified site is never also described as unclassified', () => {
    const w = bw();
    for (const s of [seasonSentence(w), seasonContextSentence(w.season)]) {
      expect(s, s).not.toMatch(/no classification/i);
      expect(s, s).not.toMatch(/not classified/i);
    }
  });

  // 🔴 No clock. A sentence that changes with the date rewrites 18 605
  // statically built pages every midnight and tells crawlers the content
  // moved when it did not.
  test('the sentence is the same whenever it is generated', () => {
    const first = seasonSentence(bw());
    const later = seasonSentence(bw());
    expect(first).toBe(later);
    expect(seasonSentence).toHaveLength(1); // one argument: the record
  });

  test('a different season produces a different year', () => {
    expect(seasonSentence(bw({ season: 2026 }))).toContain('2026');
    expect(seasonSentence(bw({ season: 2026 }))).not.toContain('2025');
  });
});

test.describe('the wording gate (CAMP-162)', () => {
  // 🔴 Applied to everything this module can print, including the
  // reassuring words. A gate that only refuses the frightening half has
  // taken a side rather than applied a rule.
  test('no forbidden word appears in any copy we can produce', () => {
    for (const s of allCopy(bw())) {
      expect(findForbiddenWords(s), s).toEqual([]);
    }
  });

  test('the gate catches both families', () => {
    expect(findForbiddenWords('Swimming here carries a risk')).toEqual(['risk']);
    expect(findForbiddenWords('The water is clean and safe')).toEqual([
      'clean',
      'safe',
    ]);
  });

  test('the gate matches whole words, so place names survive', () => {
    expect(findForbiddenWords('Lake Riskilä, Cleanthes beach')).toEqual([]);
  });

  test('the list holds both the alarming and the reassuring words', () => {
    for (const w of ['warning', 'danger', 'risk', 'clean', 'safe']) {
      expect(FORBIDDEN_WORDS).toContain(w);
    }
  });

  // The class names themselves are the directive's own vocabulary and
  // must survive the gate — otherwise the rule would forbid the data.
  test('the official class names pass the gate', () => {
    for (const label of Object.values(BATHING_STATUS_LABEL)) {
      expect(findForbiddenWords(label), label).toEqual([]);
    }
  });
});

// 🔴 `isClassified` decides which of two contradictory sentences a page
// prints, and until this block nothing pinned its TRUE side: the suite
// asserted `isClassified(notClassified) === false` and stopped, so
// `isClassified = () => false` left all 22 unit tests green — and, at
// the page level, made every classified page say "no classification".
test.describe('which records count as classified', () => {
  for (const status of ['excellent', 'good', 'sufficient', 'poor']) {
    test(`${status} is classified, and has a label`, () => {
      const w = bw({ status });
      expect(isClassified(w)).toBe(true);
      expect(statusLabel(w)).toBe(status[0].toUpperCase() + status.slice(1));
    });
  }

  test('the four classes are exactly the labels we can print', () => {
    expect(Object.keys(BATHING_STATUS_LABEL).sort()).toEqual([
      'excellent',
      'good',
      'poor',
      'sufficient',
    ]);
  });

  test('not_classified is not, and has no label to print', () => {
    const w = bw({ status: 'not_classified' });
    expect(isClassified(w)).toBe(false);
    expect(statusLabel(w)).toBeNull();
  });
});

test.describe('nothing renders empty', () => {
  test('an unclassified site says so in words', () => {
    const w = bw({ status: 'not_classified' });
    expect(isClassified(w)).toBe(false);
    expect(statusLabel(w)).toBeNull();
    expect(notClassifiedSentence(w)).toContain('no classification');
    expect(notClassifiedSentence(w)).toContain('2025');
  });

  test('no bathing water nearby says so, and says how far we looked', () => {
    const s = noBathingWaterSentence(BATHING_RADIUS_M);
    expect(s).toContain('2 km');
    expect(s).toContain('designated');
    // 🔴 And it refuses the inference. "None nearby" must not be
    // readable as "the water here is fine".
    expect(s).toContain('not a statement about the water nearby');
  });

  test('an unknown category still produces a word', () => {
    expect(categoryLabel('Nonsense')).toBe('bathing water');
    expect(categoryLabel('Lake')).toBe('lake');
  });
});

// 🔴 THE YEAR, and the words the licence asks for, are pinned to a second
// copy that another file owns. A test whose expected value comes from the
// same constant the code renders agrees with any edit to it — so these
// compare the web's copy to the API's, and to the literal the service
// itself serves.
test.describe('the constants the page renders are the ones the importer wrote', () => {
  test('the season the page pins is the season the importer writes', () => {
    expect(BATHING_SEASON).toBe(API_SEASON);
    expect(seasonLabel(BATHING_SEASON)).toBe('2025 bathing season');
  });

  test('the attribution is the one the API holds', () => {
    expect(BATHING_ATTRIBUTION).toBe(API_ATTRIBUTION);
  });

  // Read from the service's own `copyrightText` on 29.09.2026:
  //   curl -s '…/BathingWater_Dyna_WM_2025/MapServer?f=json' | jq -r .copyrightText
  // — capital B in "Bathing", lower-case s in "Member states". It is a
  // licence condition, so a retyped spelling is a defect.
  test('the attribution is verbatim, capitals and all', () => {
    expect(BATHING_ATTRIBUTION).toBe(
      'EEA, Bathing waters data and coordinates: Member states authorities.',
    );
  });

  test('the attribution passes the wording gate', () => {
    expect(findForbiddenWords(BATHING_ATTRIBUTION)).toEqual([]);
  });
});

test.describe('the radius the page describes is the radius the query used', () => {
  // 🔴 Two copies of a number is how a page ends up describing a filter
  // it does not have. The API owns it; this asserts the web copy agrees.
  test('web and API agree on the radius', () => {
    expect(BATHING_RADIUS_M).toBe(API_RADIUS_M);
  });
});

test.describe('an annual source is not stale for being a year old', () => {
  const eea = SOURCES[BATHING_SOURCE_ID];

  test('the EEA source is declared annual', () => {
    expect(eea.cadence).toBe('annual');
    expect(BATHING_FRESHNESS.cadence).toBe('annual');
    expect(BATHING_FRESHNESS.ageIsNormal).toBe(true);
  });

  // 🔴 Four years on, an annual publication is still doing what it said
  // it would. A flag here would train readers to ignore the flag.
  test('never flags an annual source, however old the edition', () => {
    for (const years of [1, 2, 4, 10]) {
      const published = new Date(2026, 5, 2);
      const today = new Date(2026 + years, 5, 2);
      expect(
        shouldFlagStale(eea, published.toISOString(), today),
        `${years}y`,
      ).toBe(false);
    }
  });

  // 🔴 The other half. Moving the cadence test must not switch the
  // existing flag off for the sources it was written for.
  test('still flags a continuous source after two years', () => {
    const osm = SOURCES.osm;
    expect(osm.cadence).toBe('continuous');
    expect(shouldFlagStale(osm, '2023-01-01', new Date('2026-09-28'))).toBe(
      true,
    );
    expect(shouldFlagStale(osm, '2026-01-01', new Date('2026-09-28'))).toBe(
      false,
    );
  });

  test('an unknown source is never flagged', () => {
    expect(shouldFlagStale(null, '1999-01-01', new Date('2026-09-28'))).toBe(
      false,
    );
  });
});

test.describe('the attribution the licence asks for', () => {
  const eea = SOURCES[BATHING_SOURCE_ID];

  test('names the EEA, its licence and where to check it', () => {
    expect(eea.name).toContain('European Environment Agency');
    expect(eea.licence).toBe('CC BY 4.0');
    expect(eea.licenceUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(eea.url).toContain('eea.europa.eu');
  });

  // The date on this source is the day a SEASON's edition was published,
  // which is a different fact from "somebody edited this record".
  test('its date label does not claim somebody updated a record', () => {
    expect(eea.dateLabel).not.toContain('Last updated');
    expect(eea.dateLabel).toContain('season');
  });
});
