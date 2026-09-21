import {
  classifyTerrain,
  formatDistance,
  TERRAIN_LABEL,
  WATER_LABEL,
} from './spot-context';

// CAMP-33. These two functions decide what a reader is told about a place
// they have never been, so both are pinned to the boundaries rather than
// to a happy-path example in the middle of each band.

describe('classifyTerrain', () => {
  it('names the four bands at their boundaries', () => {
    expect(classifyTerrain(0)).toBe('flat');
    expect(classifyTerrain(24)).toBe('flat');
    expect(classifyTerrain(25)).toBe('rolling');
    expect(classifyTerrain(69)).toBe('rolling');
    expect(classifyTerrain(70)).toBe('hilly');
    expect(classifyTerrain(149)).toBe('hilly');
    expect(classifyTerrain(150)).toBe('mountainous');
  });

  it('🔴 places measured Slovenian sites where a person would', () => {
    // Real values from the import. Coastal Izola against alpine Kranjska
    // Gora: if a threshold change ever collapses these into one word,
    // the classification has stopped saying anything.
    expect(classifyTerrain(8)).toBe('flat'); // Adriatic coast
    expect(classifyTerrain(251)).toBe('mountainous'); // Bled
    expect(classifyTerrain(444)).toBe('mountainous'); // Kranjska Gora
    expect(classifyTerrain(941)).toBe('mountainous'); // the deepest valley
  });

  it('has a label for every band it can return', () => {
    for (const relief of [0, 25, 70, 150, 1000]) {
      expect(TERRAIN_LABEL[classifyTerrain(relief)]).toBeTruthy();
    }
  });
});

describe('formatDistance', () => {
  it('keeps metres under a kilometre', () => {
    expect(formatDistance(6)).toBe('6 m');
    expect(formatDistance(365)).toBe('365 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('switches to kilometres with one decimal', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(2616)).toBe('2.6 km');
  });

  it('🔴 never rounds a distance down to nothing', () => {
    // "0 m from the lake" would be a claim the campsite is in the water.
    expect(formatDistance(1)).toBe('1 m');
    expect(formatDistance(0)).toBe('0 m');
  });
});

describe('labels', () => {
  it('covers every water kind the importer can store', () => {
    for (const kind of ['sea', 'lake', 'reservoir', 'river'] as const) {
      expect(WATER_LABEL[kind]).toBeTruthy();
    }
  });
});
