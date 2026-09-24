import {
  coreName,
  decide,
  editDistance,
  fold,
  metresApart,
  similarity,
} from './match';

// CAMP-101 — the matcher, and mainly the cases where it must NOT match.
//
// 🔴 The asymmetry is the whole design. A false split makes a duplicate
// page, which is untidy. A false merge publishes a French tourist
// office's description and an official star rating on somebody else's
// campsite, under their name — an invented fact about a named business.
// So most of what follows asserts refusal, not agreement.

const at = (lat: number, lon: number) => ({ lat, lon });

describe('distance', () => {
  it('is metres, near enough', () => {
    // One ten-thousandth of a degree of latitude is about 11 m.
    expect(metresApart(at(43.12, 6.18), at(43.1201, 6.18))).toBeCloseTo(11, 0);
    expect(metresApart(at(43.12, 6.18), at(43.12, 6.18))).toBe(0);
  });
});

describe('the distinguishing part of a name', () => {
  it('drops the words that only say "campsite"', () => {
    expect(coreName('Camping Les Pins')).toBe('pins');
    expect(coreName('Camping municipal du Lac')).toBe('lac');
    expect(coreName('Aire de camping-car Le Verger')).toBe('car verger');
  });

  it('folds accents so the two sources can meet', () => {
    expect(coreName('Camping Les Genêts')).toBe(coreName('Camping les genets'));
    expect(fold('Hyères')).toBe('hyeres');
  });

  // 🔴 A name made only of generic words carries no evidence. Returning
  // "" here would let two different municipal campsites compare equal.
  it('is null when nothing distinguishing is left', () => {
    expect(coreName('Camping')).toBeNull();
    expect(coreName('Le Camping du Village')).toBeNull();
    expect(coreName('')).toBeNull();
    expect(coreName(null)).toBeNull();
  });
});

describe('similarity', () => {
  it('is 1 for identical cores', () => {
    expect(similarity('pins', 'pins')).toBe(1);
  });

  it('survives a typo or an accent', () => {
    expect(similarity('genets', 'genet')).toBeGreaterThan(0.8);
  });

  it('is low for different names', () => {
    expect(similarity('pins', 'lac blanc')).toBeLessThan(0.5);
  });

  it('does not treat a reordering as identical', () => {
    // Word order carries information in French names, and a token-set
    // comparison would call these the same.
    expect(similarity('lac blanc', 'blanc lac')).toBeLessThan(0.85);
  });

  it('caps the edit distance rather than walking long strings', () => {
    expect(editDistance('abc', 'zzzzzzzzzzzzzzzz', 2)).toBeGreaterThan(2);
  });
});

describe('🔴 what must be merged', () => {
  it('the same name at the same place is the same campsite', () => {
    const d = decide({ name: 'Camping Les Pins', ...at(43.12, 6.18) }, [
      { id: 'osm-1', name: 'Les Pins', ...at(43.1203, 6.1801) },
    ]);
    expect(d.verdict).toBe('same');
  });

  it('an accent difference does not split a campsite', () => {
    const d = decide({ name: 'Camping Les Genêts', ...at(43.12, 6.18) }, [
      { id: 'osm-1', name: 'Camping les Genets', ...at(43.1201, 6.18) },
    ]);
    expect(d.verdict).toBe('same');
  });
});

describe('🔴 what must NOT be merged', () => {
  it('two different campsites in the same commune stay apart', () => {
    const d = decide({ name: 'Camping Les Pins', ...at(43.12, 6.18) }, [
      { id: 'osm-1', name: 'Camping Le Lac Blanc', ...at(43.1202, 6.1802) },
    ]);
    expect(d.verdict).toBe('new');
  });

  // 🔴 This test found a real bug. "municipal" was missing from the
  // generic list, so both cores came out as "municipal", similarity was
  // 1, and two different municipal campsites 25 m apart were merged —
  // which would have put one commune's description and star rating on
  // the other's page. It is the commonest campsite name in France.
  it('two municipal campsites are not the same because both are municipal', () => {
    const d = decide({ name: 'Camping Municipal', ...at(43.12, 6.18) }, [
      { id: 'osm-1', name: 'Camping Municipal', ...at(43.1202, 6.1802) },
    ]);
    // Neither name carries evidence, so this is a question, not a merge.
    expect(d.verdict).toBe('review');
  });

  it('but a municipal campsite with a real name still matches', () => {
    const d = decide({ name: 'Camping Municipal du Lac', ...at(43.12, 6.18) }, [
      { id: 'osm-1', name: 'Camping du Lac', ...at(43.1201, 6.18) },
    ]);
    expect(d.verdict).toBe('same');
  });

  // 🔴 26% of Slovenian OSM campsites have no name at all. "Something
  // unnamed 40 m away" is not evidence that it is THIS campsite.
  it('an unnamed neighbour is never merged automatically', () => {
    const d = decide({ name: 'Camping Les Pins', ...at(43.12, 6.18) }, [
      { id: 'osm-1', name: null, ...at(43.12, 6.1801) },
    ]);
    expect(d.verdict).toBe('review');
    expect(d.verdict === 'review' && d.why).toContain('no distinguishing name');
  });

  it('the same name far away is two campsites, or a question', () => {
    const d = decide({ name: 'Camping Les Pins', ...at(43.12, 6.18) }, [
      // ~300 m — beyond a footprint, inside the outer radius.
      { id: 'osm-1', name: 'Les Pins', ...at(43.1227, 6.18) },
    ]);
    expect(d.verdict).toBe('review');
    expect(d.verdict === 'review' && d.why).toContain('m apart');
  });

  it('nothing nearby is simply new', () => {
    const d = decide({ name: 'Camping Les Pins', ...at(43.12, 6.18) }, [
      { id: 'osm-1', name: 'Les Pins', ...at(44.0, 6.18) },
    ]);
    expect(d.verdict).toBe('new');
  });

  it('an empty candidate list is new', () => {
    expect(
      decide({ name: 'Camping Les Pins', ...at(43.12, 6.18) }, []).verdict,
    ).toBe('new');
  });
});

describe('the answer is stable and explainable', () => {
  it('picks the best candidate, not merely the nearest', () => {
    const d = decide({ name: 'Camping Les Pins', ...at(43.12, 6.18) }, [
      { id: 'near-wrong', name: 'Le Lac Blanc', ...at(43.12, 6.1801) },
      { id: 'far-right', name: 'Les Pins', ...at(43.1205, 6.1802) },
    ]);
    expect(d.verdict).toBe('same');
    expect(d.verdict !== 'new' && d.id).toBe('far-right');
  });

  it('always says why, so a human can check the decision', () => {
    for (const candidates of [
      [],
      [{ id: 'a', name: null, lat: 43.12, lon: 6.18 }],
      [{ id: 'b', name: 'Les Pins', lat: 43.12, lon: 6.18 }],
    ]) {
      const d = decide(
        { name: 'Camping Les Pins', ...at(43.12, 6.18) },
        candidates,
      );
      expect(d.why.length).toBeGreaterThan(10);
    }
  });
});
