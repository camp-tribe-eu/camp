import { expect, test } from '@playwright/test';
import {
  CampsiteCards,
  CountryCards,
  RegionCards,
  nearLine,
} from '@/components/search-cards';
import { searchText, type SearchDoc, type SearchHit } from '@/lib/search';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-455 — результати КАРТКАМИ.
//
// 🔴 УСЕ ЧИТАЄТЬСЯ З ВІДДАНОГО HTML. Не з константи й не з імені класу:
// «картка показує назву й країну» — це твердження про текст, який
// бачить читач, тож і перевірка бере `visibleText(html)`.

const doc = (name: string, country = 'hr', region = 'istria'): SearchDoc => {
  const base = {
    kind: 'campsite' as const,
    name,
    path: `/camping/${country}/${region}/${name.toLowerCase().replace(/ /g, '-') || 'x'}`,
    country,
    region,
    near: [] as { name: string; m: number }[],
  };
  return { ...base, text: searchText(base) };
};

const hit = (d: SearchDoc, label?: SearchHit['label']): SearchHit => ({
  doc: d,
  score: 1,
  label,
});

test('🔴 a campsite card carries the flag, the country, the name, the region and a link', () => {
  const html = renderComponent(CampsiteCards, {
    hits: [hit(doc('Camp Mlin', 'hr', 'splitsko-dalmatinska'))],
  });
  const text = visibleText(html);
  expect(text).toContain('Croatia');
  expect(text).toContain('Camp Mlin');
  expect(text).toContain('Splitsko Dalmatinska');
  expect(html).toContain('href="/camping/hr/splitsko-dalmatinska/camp-mlin"');
  expect(html).toMatch(/<img class="ct-flag" src="\/flags\/hr\.svg"/);
});

test('🔴 there is one card per hit — no more, no fewer', () => {
  const hits = ['A', 'B', 'C', 'D', 'E'].map((n) => hit(doc(`Camp ${n}`)));
  const html = renderComponent(CampsiteCards, { hits });
  expect((html.match(/data-testid="search-card-campsite"/g) ?? []).length).toBe(5);
  expect((html.match(/<li>/g) ?? []).length).toBe(5);
});

test('an unnamed campsite says so instead of printing a blank or a slug', () => {
  const html = renderComponent(CampsiteCards, { hits: [hit(doc(''))] });
  expect(visibleText(html)).toContain('Unnamed campsite');
});

test('🔴 a place the query named is printed, and a distance only when it is the ordering one', () => {
  const near = renderComponent(CampsiteCards, {
    hits: [hit(doc('Camp X'), { name: 'Bari', m: 2192, isNearest: true })],
  });
  expect(visibleText(near)).toContain('2.2 km from Bari');

  // The label is NOT the nearest place: the distance is dropped, the
  // place stays (CAMP-140).
  const other = renderComponent(CampsiteCards, {
    hits: [hit(doc('Camp X'), { name: 'Tolmin', m: 489, isNearest: false })],
  });
  const text = visibleText(other);
  expect(text).toContain('near Tolmin');
  expect(text).not.toContain('489');

  expect(nearLine(undefined)).toBeNull();
});

test('🔴 a region card links to the region and prints its count only when told it is complete', () => {
  const regions = [
    { country: 'it', region: 'bari', name: 'Bari', count: 112, text: 'bari italy' },
  ];
  const whole = renderComponent(RegionCards, { regions, showCounts: true });
  expect(whole).toContain('href="/camping/it/bari"');
  expect(visibleText(whole)).toContain('112 campsites');

  // While the index is still arriving the count would be a partial one,
  // and a partial count printed as a fact is a wrong number.
  const partial = renderComponent(RegionCards, { regions, showCounts: false });
  expect(visibleText(partial)).not.toContain('112');
  expect(visibleText(partial)).not.toMatch(/\d+ campsites?/);
  expect(visibleText(partial)).toContain('Bari');
});

test('a region with one campsite says "1 campsite", not "1 campsites"', () => {
  const html = renderComponent(RegionCards, {
    regions: [{ country: 'it', region: 'x', name: 'X', count: 1, text: 'x italy' }],
    showCounts: true,
  });
  expect(visibleText(html)).toContain('1 campsite');
  expect(visibleText(html)).not.toContain('1 campsites');
});

test('🔴 a country card prints the counts it was given, with a thousands separator', () => {
  const html = renderComponent(CountryCards, {
    countries: [
      { country: 'fr', name: 'France', spots: 17915, regions: 96, text: 'france' },
    ],
  });
  const text = visibleText(html);
  expect(text).toContain('17,915 campsites');
  expect(text).toContain('96 regions');
  expect(html).toContain('href="/camping/fr"');
  expect(html).toMatch(/<img class="ct-flag" src="\/flags\/fr\.svg"/);
});

test('a country without a flag file draws its letters, not a broken image', () => {
  const html = renderComponent(CountryCards, {
    countries: [{ country: 'zz', name: 'Nowhere', spots: 2, regions: 1, text: 'nowhere' }],
  });
  expect(html).not.toContain('<img');
  expect(visibleText(html)).toContain('ZZ');
});
