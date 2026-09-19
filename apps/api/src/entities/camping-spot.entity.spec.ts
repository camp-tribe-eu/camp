import { CampingSpotType } from './camping-spot.entity';

// Locks the enum values to the exact filter set from mvp-strategy.md
// (Camping Map Explorer, CAMP-2). If someone renames a value here without
// updating the frontend filter UI, this fails loudly instead of the filter
// silently matching nothing.
describe('CampingSpotType', () => {
  it('has exactly the filters specified in mvp-strategy.md', () => {
    const values = Object.values(CampingSpotType).sort();
    expect(values).toEqual(
      ['camper_stop', 'free', 'paid', 'rv_park', 'wild'].sort(),
    );
  });
});
