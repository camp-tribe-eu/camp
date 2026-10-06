import { expect, test } from '@playwright/test';
import corpus from '@/data/guide-slugs.json';
import {
  byCountry,
  byTopic,
  CLICKS_TO_ANY_GUIDE,
  isTopic,
  parseGuideSlug,
  parsed,
  TOPICS,
  unparsed,
} from '@/lib/guide-facets';

// CAMP-210 — the catalogue that has to carry 1 268 articles.
//
// 🔴 MEASURED AGAINST THE GENERATOR'S OWN OUTPUT, not against slugs I
// typed. `src/data/guide-slugs.json` is every slug in the production
// database, read on 06.10.2026. CI's fixture supports four guides; the
// parser has to hold against 1 268, and four would prove nothing.
//
// The spec this protects is one sentence: every guide is reachable from
// `/guides` in at most three clicks. That is only true while every slug
// parses into a facet some page lists. A slug the parser does not
// understand is an article nobody can reach, and the symptom — a
// catalogue that is subtly incomplete — is invisible from the outside.

const SLUGS = corpus.slugs.map((slug) => ({ slug }));

test.describe('the guide slug corpus', () => {
  test('is the real one, and says when it was taken', () => {
    // 🔴 A corpus that silently shrank would make every claim below
    // easier and none of them truer.
    expect(corpus.count).toBe(corpus.slugs.length);
    expect(corpus.count).toBeGreaterThan(1200);
    // 🔴 The corpus is every row; the site serves only the published
    // ones. Pinned so the two numbers cannot quietly become one.
    expect(corpus.published + corpus.archived).toBe(corpus.count);
    expect(corpus.takenAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Set(corpus.slugs).size, 'the corpus has duplicates').toBe(corpus.count);
  });

  test('🔴 every single slug parses — a guide that does not is unreachable', () => {
    const lost = unparsed(SLUGS);
    expect(
      lost.map((g) => g.slug),
      'these guides belong to no facet, so no catalogue page links them'
    ).toEqual([]);
  });

  test('…and the topics in the data are exactly the topics we declare', () => {
    const seen = new Set(parsed(SLUGS).map((g) => g.facets.topic));
    // 🔴 This catches one direction: a topic we DECLARE that the data
    // never produces — a heading over nothing. The other direction, a
    // topic in the data we never declared, is caught by the parse test
    // above, because an undeclared topic makes its slug unparseable.
    // Review measured it: adding such a slug to the corpus leaves THIS
    // test green and reddens that one. The comment used to claim both.
    expect([...seen].sort()).toEqual(Object.keys(TOPICS).sort());
  });

  test('…and every country code is a country code', () => {
    for (const g of parsed(SLUGS)) {
      expect(g.facets.country, g.slug).toMatch(/^[a-z]{2}$/);
    }
  });
});

test.describe('three clicks to any of them', () => {
  test('🔴 every guide appears on a country page AND on a topic page', () => {
    const onCountry = new Set(byCountry(SLUGS).flatMap((c) => c.guides.map((g) => g.slug)));
    const onTopic = new Set(byTopic(SLUGS).flatMap((t) => t.guides.map((g) => g.slug)));

    const missing = corpus.slugs.filter((s) => !onCountry.has(s) || !onTopic.has(s));
    expect(missing, 'guides the catalogue does not link from anywhere').toEqual([]);
    // hub → facet → article. The card asked for no more than three.
    expect(CLICKS_TO_ANY_GUIDE).toBeLessThanOrEqual(3);
  });

  test('…and no guide is counted twice on the same page', () => {
    for (const { country, guides } of byCountry(SLUGS)) {
      expect(new Set(guides.map((g) => g.slug)).size, country).toBe(guides.length);
    }
    for (const { topic, guides } of byTopic(SLUGS)) {
      expect(new Set(guides.map((g) => g.slug)).size, topic).toBe(guides.length);
    }
  });

  test('…and the counts add up to the corpus, both ways', () => {
    const viaCountry = byCountry(SLUGS).reduce((n, c) => n + c.guides.length, 0);
    const viaTopic = byTopic(SLUGS).reduce((n, t) => n + t.guides.length, 0);
    expect(viaCountry).toBe(corpus.count);
    expect(viaTopic).toBe(corpus.count);
  });

  test('…and the biggest single page is a size a page can be', () => {
    // 🔴 Named rather than assumed. France has 366 guides and "water"
    // has 466, so a facet page is a long list — that is the trade for
    // reaching any article in two clicks instead of paging through 53
    // screens. If a facet ever passes a thousand it has stopped being a
    // page, and this is where that gets noticed.
    const biggest = Math.max(
      ...byCountry(SLUGS).map((c) => c.guides.length),
      ...byTopic(SLUGS).map((t) => t.guides.length)
    );
    expect(biggest).toBeLessThan(1000);
  });
});

test.describe('the parser refuses what it does not know', () => {

  test('a topic we never declared is not guessed into a heading', () => {
    expect(parseGuideSlug('fr-vosges-winter')).toBeNull();
    expect(isTopic('winter')).toBe(false);
  });

  test('a slug with no region is not a guide slug', () => {
    expect(parseGuideSlug('fr-water')).toBeNull();
  });

  test('a first segment that is not a country code is refused', () => {
    expect(parseGuideSlug('france-vosges-water')).toBeNull();
    expect(parseGuideSlug('f1-vosges-water')).toBeNull();
  });

  test('a region with hyphens of its own survives, read from both ends', () => {
    expect(parseGuideSlug('de-nordrhein-westfalen-water')).toEqual({
      country: 'de',
      region: 'nordrhein-westfalen',
      topic: 'water',
    });
  });

  test('every declared topic has a label a reader can read', () => {
    for (const [topic, label] of Object.entries(TOPICS)) {
      expect(label.length, topic).toBeGreaterThan(3);
      expect(label, topic).not.toBe(topic);
    }
  });
});
