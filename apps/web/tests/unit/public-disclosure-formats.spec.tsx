import { expect, test } from '@playwright/test';
import {
  scanPage,
  visibleText as guardText,
} from '../../../../scripts/ci/disclosure-rules.mjs';
import ProviderPageView from '@/app/camper-rental/providers/[slug]/page';
import OpeningHours from '@/components/opening-hours';
import RentalDisclosure from '@/components/rental-disclosure';
import RentalOfferSlot from '@/components/rental-offer-slot';
import RouteSources from '@/components/route-sources';
import { cardProvenanceLabel } from '@/lib/guides';
import { humanOpeningHours } from '@/lib/opening-hours';
import { overnightTagPhrase } from '@/lib/overnight';
import { readableDay, scaleParts } from '@/lib/rental-providers';
import { renderAsyncComponent, renderComponent } from './render-component';

// CAMP-463 — формат, а не лише слова. Те, що читач бачить, коли база чи
// мапа віддали машинну форму.
//
// 🔴 Кожен тест тут читає ВІДДАНУ РОЗМІТКУ, а не константу й не клас:
// `scanPage` — це той самий читач видимого тексту, яким ходить сторож
// `scripts/ci/check-no-internal-disclosure.mjs`. Тобто «сторінка не
// показує ISO-дати» тут означає рівно те, що означає в CI.

// ── години ──────────────────────────────────────────────────────────────

test.describe('humanOpeningHours: слова лише тоді, коли розбір точний', () => {
  const READ: Array<[string, string]> = [
    ['24/7', 'Open around the clock, every day'],
    ['Mo-Su 08:00-20:00', 'Mon–Sun 08:00–20:00'],
    [
      'Mo 15:30-19:45; Tu-Sa 08:30-13:00,15:30-19:45',
      'Mon 15:30–19:45; Tue–Sat 08:30–13:00, 15:30–19:45',
    ],
    ['Mo-Fr 09:00-18:00; Sa 09:00-13:00', 'Mon–Fri 09:00–18:00; Sat 09:00–13:00'],
    ['Mo-Sa 09:00-20:00;Su off', 'Mon–Sat 09:00–20:00; Sun closed'],
    ['Mo,We,Fr 10:00-12:00', 'Mon, Wed, Fri 10:00–12:00'],
    ['Mo-Su 00:00-24:00', 'Mon–Sun 00:00–24:00'],
  ];
  for (const [raw, words] of READ) {
    test(`читається: ${raw}`, () => {
      expect(humanOpeningHours(raw)).toBe(words);
    });
  }

  // 🔴 ВСЕ АБО НІЧОГО. Кожне з цих значень «майже» в граматиці, і саме
  // тому небезпечне: часткове прочитання дало б читачеві брехню про
  // державне свято, сезон чи ніч.
  const NOT_READ = [
    'Mo-Su 08:00-20:00; PH off', // свято: «щодня» було б брехнею
    'Apr-Oct Mo-Su 08:00-20:00', // сезон
    'Mo-Su sunrise-sunset',
    'Mo-Su 08:00-20:00 "by appointment"', // коментар
    'Sa-Mo 08:00-20:00', // через тиждень
    'Mo-Fr 09:00-18:00; Mo 10:00-11:00', // день названо двічі: перекриття
    'Mo-Su 99:99-88:88', // не годинник
    'Mo-Su 08:00-24:30', // 24:30 — не час
    'Mo-Su 08:00-20:00;', // обірване правило
    'Mo 08:00+',
    '',
    '   ',
  ];
  for (const raw of NOT_READ) {
    test(`не читається, лишається як записано: ${JSON.stringify(raw)}`, () => {
      expect(humanOpeningHours(raw)).toBeNull();
    });
  }
  test('відсутнє значення — не година', () => {
    expect(humanOpeningHours(null)).toBeNull();
    expect(humanOpeningHours(undefined)).toBeNull();
  });
});

test.describe('<OpeningHours>: слова або спойлер, ніколи сирий рядок у тілі', () => {
  test('розібране — словами, без сирого синтаксису в тексті', () => {
    const html = renderComponent(OpeningHours, {
      value: 'Mo 15:30-19:45; Tu-Sa 08:30-13:00,15:30-19:45',
    });
    expect(html).toContain('data-hours="read"');
    expect(guardText(html)).toContain('Mon 15:30–19:45; Tue–Sat 08:30–13:00, 15:30–19:45');
    expect(scanPage('/x', `<main>${html}</main>`)).toEqual([]);
  });

  test('нерозібране — під спойлером «Opening hours as recorded»', () => {
    const raw = 'Mo-Su 08:00-20:00; PH off';
    const html = renderComponent(OpeningHours, { value: raw });
    expect(html).toContain('<details');
    expect(html).toContain('data-hours="as-recorded"');
    expect(html).toContain('Opening hours as recorded');
    // сирий рядок є — але лише всередині спойлера
    expect(html).toContain(raw);
    expect(html.indexOf(raw)).toBeGreaterThan(html.indexOf('<summary'));
    // і сторож це бачить так само: спойлер — законне місце, тіло — ні
    expect(scanPage('/x', `<main>${html}</main>`)).toEqual([]);
  });

  test('🔴 той самий рядок поза спойлером сторож ловить (інакше спойлер — ширма)', () => {
    const hits = scanPage('/x', '<main><span>Mo 15:30-19:45; Tu-Sa 08:30-13:00</span></main>');
    expect(hits.map((h) => h.id)).toEqual(['B-osm-hours']);
  });
});

// ── тег нічлігу ─────────────────────────────────────────────────────────

test.describe('overnightTagPhrase: тег словами', () => {
  test('усі значення, що їх API взагалі пише', () => {
    expect(overnightTagPhrase('motorhome=yes')).toBe('open to motorhomes');
    expect(overnightTagPhrase('motorhome=designated')).toBe('signposted for motorhomes');
    expect(overnightTagPhrase('motorhome=yes;designated')).toBe(
      'open to motorhomes and signposted for them',
    );
    expect(overnightTagPhrase('motorhome=designated;yes')).toBe(
      'open to motorhomes and signposted for them',
    );
    expect(overnightTagPhrase('motorhome=no')).toBe('closed to motorhomes');
  });
  test('🔴 невідоме значення — нейтральне речення, а не вгадане', () => {
    for (const odd of ['motorhome=private', 'motorhome=yes;no', 'access=yes', 'x']) {
      expect(overnightTagPhrase(odd), odd).toBe('tagged for motorhomes');
    }
  });
});

// ── масштаб, дати ───────────────────────────────────────────────────────

test.describe('scaleParts: перелік того, що є', () => {
  test('роздільник стоїть між значеннями, а не після', () => {
    expect(scaleParts({ declaredDepotCount: 1, declaredFleetSize: 3, foundedYear: null })).toEqual([
      '1 depot',
      'fleet of 3',
    ]);
    expect(
      scaleParts({ declaredDepotCount: 4, declaredFleetSize: 60, foundedYear: 2011 }).join(' · '),
    ).toBe('4 depots · fleet of 60 · trading since 2011');
  });
  test('нічого не відомо — порожній перелік, а не порожній рядок', () => {
    expect(scaleParts({ declaredDepotCount: null, declaredFleetSize: null, foundedYear: null })).toEqual([]);
  });
  test('нуль — це значення, а не відсутність', () => {
    expect(scaleParts({ declaredDepotCount: 0, declaredFleetSize: null, foundedYear: null })).toEqual(['0 depots']);
  });
});

test.describe('readableDay', () => {
  test('ISO-мітка з часом — людською формою; чиста дата — так само', () => {
    expect(readableDay('2026-11-03T00:00:00.000Z')).toBe('3 November 2026');
    expect(readableDay('2026-11-03')).toBe('3 November 2026');
  });
  test('не дата — як є, щоб дивне було видно, а не вигадане', () => {
    expect(readableDay('soon')).toBe('soon');
    expect(readableDay('2026-13-45')).toBe('2026-13-45');
  });
});

const PROVIDER = {
  slug: 'auto-grupp-2000',
  name: 'Auto Grupp 2000',
  intro: 'An Estonian company.',
  whatToKnow: null,
  legalName: null,
  registrationNumber: null,
  homeCountry: 'EE',
  website: null,
  email: null,
  phone: null,
  declaredDepotCount: 1,
  declaredFleetSize: 3,
  foundedYear: null,
  sourceUrl: 'https://example.test/about',
  sourceCheckedOn: '2026-11-03T00:00:00.000Z',
  services: [
    {
      code: 'awning',
      availability: 'included',
      note: 'Listed as included',
      source_url: 'https://example.test/terms',
      source_checked_on: '2026-11-03T00:00:00.000Z',
    },
    {
      code: 'bike_rack',
      availability: 'included',
      note: null,
      source_url: null,
      source_checked_on: '2026-11-03T00:00:00.000Z',
    },
  ],
  vehicles: [
    {
      name: 'Carado A461',
      slug: 'carado-a461',
      berths: 4,
      belted_seats: 4,
      length_cm: 741,
      camper_type_slug: 'alcove',
      camper_type_name: 'Over-cab motorhome',
      camper_type_said: 'Alcove',
      camper_type_checked_on: '2026-11-03T00:00:00.000Z',
      source_url: 'https://example.test/fleet',
      source_checked_on: '2026-11-03T00:00:00.000Z',
    },
  ],
  reviewProfiles: [],
};

async function renderProvider(payload: unknown): Promise<string> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
  try {
    return await renderAsyncComponent(ProviderPageView, {
      params: Promise.resolve({ slug: PROVIDER.slug }),
    });
  } finally {
    globalThis.fetch = real;
  }
}

test.describe('сторінка компанії, коли база віддає ISO-мітки', () => {
  test('🔴 жодної ISO-мітки у видимому тексті, а в `datetime` — чиста дата', async () => {
    const html = await renderProvider(PROVIDER);
    // Знаменник: сторінка справді містить дати, інакше «немає ISO» нічого б не значило.
    const text = guardText(html);
    expect((text.match(/3 November 2026/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(html).toContain('<time dateTime="2026-11-03">3 November 2026</time>');
    expect(scanPage('/camper-rental/providers/auto-grupp-2000', html)).toEqual([]);
  });

  test('🔴 «depots: 1 · fleet: 3 ·» — обірваного роздільника більше немає', async () => {
    const html = await renderProvider(PROVIDER);
    expect(guardText(html)).toContain('1 depot · fleet of 3');
    expect(guardText(html)).not.toMatch(/·\s*(\n|$)/);
    expect(html).toContain('data-testid="declared-scale"');
  });

  test('нічого не відомо про масштаб — порожнього рядка не малюємо', async () => {
    const html = await renderProvider({
      ...PROVIDER,
      declaredDepotCount: null,
      declaredFleetSize: null,
      sourceUrl: null,
      sourceCheckedOn: null,
    });
    expect(html).not.toContain('data-testid="declared-scale"');
    expect(html).not.toContain('Scale, as the company states it');
  });
});

// ── джерела на сторінці маршруту ────────────────────────────────────────

test.describe('<RouteSources>: назва, джерело, ліцензія, дата — а не сирий URL', () => {
  const sources = [
    {
      id: 'datatourisme',
      ref: 'https://data.datatourisme.fr/23/e437c815-500c-375e-9720-84692c3a214a',
      updatedAt: '2024-11-17T00:00:00.000Z',
      fields: ['name'],
      spotName: 'Camping Les Pins',
    },
    {
      id: 'osm',
      ref: 'a2458948828',
      updatedAt: '2026-11-10',
      fields: ['name'],
      spotName: null,
    },
  ];
  const render = () =>
    renderComponent(RouteSources, {
      sources,
      campsiteCount: 2,
      serviceCount: 3,
      note: 'The campsites come from our own database.',
    });

  test('🔴 сирого URL у видимому тексті немає, але посилання на запис лишилось', () => {
    const html = render();
    const text = guardText(html);
    expect(text).not.toContain('data.datatourisme.fr');
    expect(html).toContain(
      'href="https://data.datatourisme.fr/23/e437c815-500c-375e-9720-84692c3a214a"',
    );
    expect(text).toContain('Camping Les Pins');
    expect(text).toContain('record at the source');
    // Licence Ouverte 2.0: дата оновлення джерелом — обовʼязкова. Вона тут, і людською формою.
    expect(text).toContain('17 November 2024');
    expect(text).toContain('10 November 2026');
    expect(text).toContain('Unnamed campsite');
    expect(text).not.toMatch(/\ba2458948828\b/);
    expect(scanPage('/routes/x', `<main>${html}</main>`)).toEqual([]);
  });

  test('назва джерела й ліцензія — з посиланнями, як і були', () => {
    const html = render();
    expect(html).toContain('DATAtourisme');
    expect(html).toContain('Licence Ouverte');
    expect(html).toContain('OpenStreetMap');
    expect(html).toContain('Open Database License');
  });

  test('🔴 УМОВА ЛІЦЕНЗІЇ: позицію Produced Work цей PR не чіпає, слово в слово', () => {
    const text = guardText(render());
    expect(text).toContain(
      'Under the Open Database License it is a Produced Work rather than a derivative database, so the share-alike term does not apply to it.',
    );
  });
});

// ── оренда: порожнє не малюємо ──────────────────────────────────────────

test.describe('оренда, коли партнерських посилань немає', () => {
  test('розкриття й слот не малюються й не розповідають про наш стан', () => {
    expect(renderComponent(RentalDisclosure, { offers: 0 })).toBe('');
    expect(renderComponent(RentalOfferSlot, { offers: [], where: 'France' })).toBe('');
  });

  test('🔴 а коли посилання Є, розкриття стоїть на місці (UCPD ст. 7(2))', () => {
    const html = renderComponent(RentalDisclosure, { offers: 1 });
    expect(html).toContain('data-testid="rental-disclosure"');
    expect(guardText(html)).toContain('Some links on this page are affiliate links.');
  });
});

// ── гіди ────────────────────────────────────────────────────────────────

test.describe('картка гіда', () => {
  test('згенерована з бази — без позначки (одна над переліком), решта — з нею', () => {
    expect(cardProvenanceLabel('data-generated')).toBeNull();
    expect(cardProvenanceLabel('human')).toBe('Written by a person');
    expect(cardProvenanceLabel('ai-generated')).toBe('Written by a machine');
    expect(cardProvenanceLabel('ai-assisted')).toBe('Written with machine help');
  });
});
