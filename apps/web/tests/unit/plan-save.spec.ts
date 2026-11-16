import { expect, test } from '@playwright/test';

import { EMPTY_DRAFT, MAX_VIA, type ChosenPlace, type PlanDraft } from '@/lib/plan';
import {
  addSaved,
  decodeShare,
  defaultName,
  draftFromUnknown,
  encodeShare,
  FORMAT,
  MAX_SAVED,
  MAX_SHARE,
  parseSaved,
  removeSaved,
  serializeSaved,
  snapshotOf,
  type SavedTrip,
} from '@/lib/plan-save';

// CAMP-456 — збереження й посилання, без браузера. Усе тут — про текст, який
// прийшов ЗЗОВНІ (сховище, адреса): він може бути чим завгодно, і сторінка
// має відкритись у кожному випадку.

const bled: ChosenPlace = {
  kind: 'town',
  name: 'Bled',
  country: 'si',
  lat: 46.3683,
  lon: 14.1146,
  label: 'Bled, Slovenia',
};
const camp: ChosenPlace = {
  kind: 'campsite',
  name: 'Camping Zaton',
  country: 'hr',
  lat: 44.2,
  lon: 15.2,
  slug: 'camping-zaton',
  label: 'Camping Zaton (campsite), Croatia',
};

const TRIP: PlanDraft = {
  ...EMPTY_DRAFT,
  from: bled.label,
  fromPlace: bled,
  to: camp.label,
  toPlace: camp,
  days: '9',
  via: [
    { id: '1', text: '45.5, 15.5', place: null },
    { id: '2', text: 'Žabljak ünïcode', place: null },
  ],
  roundTrip: true,
  vehicle: { type: 'motorhome', height: '3,1', length: '7.4', weight: '3.5' },
};

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');

test.describe('посилання «поділитися»', () => {
  test('🔴 туди й назад: чернетка з місцями, проміжними точками, зворотним шляхом і габаритами повертається такою, якою пішла', () => {
    const back = decodeShare(encodeShare(TRIP));
    expect(back).toEqual(TRIP);
  });

  test('🔴 стан у фрагменті, а не в запиті: ні «?», ні «&», і нічого, що сервер побачив би в журналі доступу', () => {
    const fragment = encodeShare(TRIP);
    // Лише алфавіт base64url: жодних символів, які ламають адресу чи просять екранування.
    expect(fragment).toMatch(/^t=[A-Za-z0-9_-]+$/);
    expect(fragment.slice(2)).not.toMatch(/[?&=%+/]/);
  });

  test('з `#` чи без — те саме', () => {
    const f = encodeShare(TRIP);
    expect(decodeShare(`#${f}`)).toEqual(decodeShare(f));
  });

  test('🔴 чуже, обірване й зіпсоване — null, а не виняток: сторінка відкривається', () => {
    const good = encodeShare(TRIP);
    const bad = [
      '',
      '#',
      't=',
      'x=abc',
      't=!!!',
      't=' + 'A'.repeat(MAX_SHARE),
      good.slice(0, good.length - 7),
      `${good}%`,
      `t=${b64('not an object')}`,
      `t=${b64({ v: FORMAT + 1 })}`,
      `t=${Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url')}`,
    ];
    for (const fragment of bad) {
      expect(() => decodeShare(fragment), fragment.slice(0, 30)).not.toThrow();
      expect(decodeShare(fragment), fragment.slice(0, 30)).toBeNull();
    }
  });

  test('🔴 довге посилання відхиляється за довжиною, а не розбирається — навіть коли все в ньому правильне', () => {
    // Правильна чернетка з величезним зайвим полем: за змістом її можна було б
    // прочитати, тож відмовляє саме ліміт довжини, а не перевірка полів.
    const padded = { ...snapshotOf(TRIP), padding: 'x'.repeat(MAX_SHARE) };
    expect(decodeShare(`t=${b64(snapshotOf(TRIP))}`)).toEqual(TRIP);
    expect(decodeShare(`t=${b64(padded)}`)).toBeNull();
  });

  test('🔴 поле неправильного типу чи завеликої довжини коштує всієї чернетки, а не обрізається', () => {
    const snap = snapshotOf(TRIP);
    const cases: Array<Record<string, unknown>> = [
      { ...snap, d: 9 },
      { ...snap, f: 'x'.repeat(201) },
      { ...snap, rt: 'yes' },
      { ...snap, ve: ['', '1', '2'] },
      { ...snap, ve: ['rocket', '', '', ''] },
      { ...snap, via: 'nope' },
      { ...snap, via: [{ t: 5 }] },
      { ...snap, via: Array.from({ length: MAX_VIA + 1 }, () => ({ t: 'a', p: null })) },
    ];
    for (const c of cases) expect(draftFromUnknown(c), JSON.stringify(c).slice(0, 60)).toBeNull();
  });

  test('🔴 зіпсоване МІСЦЕ коштує місця, а не поїздки: текст лишається, форма попросить обрати знову', () => {
    for (const p of [
      { ...snapshotOf(TRIP).fp as object, la: 999 },
      { ...snapshotOf(TRIP).fp as object, k: 'galaxy' },
      { ...snapshotOf(TRIP).fp as object, c: 'SLO' },
      { ...snapshotOf(TRIP).tp as object, s: '../etc/passwd' },
      'Bled',
    ]) {
      const snap = { ...snapshotOf(TRIP), fp: p, tp: p };
      const d = draftFromUnknown(snap);
      expect(d, JSON.stringify(p)).not.toBeNull();
      expect(d!.fromPlace).toBeNull();
      expect(d!.from).toBe(bled.label);
    }
  });

  test('номери проміжних точок присвоюються наново, за порядком: чужі номери не переносяться', () => {
    const snap = { ...snapshotOf(TRIP) };
    const d = draftFromUnknown(snap)!;
    expect(d.via.map((v) => v.id)).toEqual(['1', '2']);
  });
});

test.describe('збережені поїздки', () => {
  const trip = (id: string, name = id): SavedTrip => ({ id, name, savedAt: 1_700_000_000_000, draft: TRIP });

  test('туди й назад через рядок сховища', () => {
    const raw = serializeSaved([trip('a'), trip('b')]);
    expect(parseSaved(raw)).toEqual({ trips: [trip('a'), trip('b')], dropped: 0 });
  });

  test('порожнє сховище — порожній перелік і нуль втрат, а не «щось пропало»', () => {
    expect(parseSaved(null)).toEqual({ trips: [], dropped: 0 });
  });

  test('🔴 один зіпсований запис коштує одного запису, а скільки втрачено — повертається числом', () => {
    const top = JSON.parse(serializeSaved([trip('a'), trip('b'), trip('c')]));
    top.trips[1].draft.d = 7; // зіпсовано рівно один
    const r = parseSaved(JSON.stringify(top));
    expect(r.trips.map((t) => t.id)).toEqual(['a', 'c']);
    expect(r.dropped).toBe(1);
  });

  test('🔴 кожен із способів бути зіпсованим — окремо, і кожен коштує рівно одного запису', () => {
    const ok = JSON.parse(serializeSaved([trip('keep')])).trips[0];
    const broken: unknown[] = [
      null,
      'text',
      7,
      [],
      { ...ok, id: '' },
      { ...ok, id: 5 },
      { ...ok, name: '' },
      { ...ok, name: 'x'.repeat(61) },
      { ...ok, savedAt: 'yesterday' },
      { ...ok, savedAt: Infinity },
      { ...ok, draft: null },
      { ...ok, draft: { v: 99 } },
    ];
    for (const b of broken) {
      const raw = JSON.stringify({ v: FORMAT, trips: [ok, b] });
      const r = parseSaved(raw);
      expect(r.trips.map((t) => t.id), JSON.stringify(b)).toEqual(['keep']);
      expect(r.dropped, JSON.stringify(b)).toBe(1);
    }
  });

  test('однакові номери: другий — втрата, а не тиха заміна', () => {
    const raw = serializeSaved([trip('a', 'first'), trip('a', 'second')]);
    const r = parseSaved(raw);
    expect(r.trips.map((t) => t.name)).toEqual(['first']);
    expect(r.dropped).toBe(1);
  });

  test('🔴 сховище, що не JSON чи іншої версії, — порожній перелік і явна втрата, а не виняток', () => {
    for (const raw of ['{', 'null', '"x"', '[]', JSON.stringify({ v: 99, trips: [] }), JSON.stringify({ v: FORMAT })]) {
      expect(() => parseSaved(raw), raw).not.toThrow();
      expect(parseSaved(raw), raw).toEqual({ trips: [], dropped: 1 });
    }
  });

  test('понад MAX_SAVED у сховищі: зайве не губиться мовчки, а рахується втратою', () => {
    const many = Array.from({ length: MAX_SAVED + 3 }, (_, i) => trip(`t${i}`));
    const r = parseSaved(serializeSaved(many));
    expect(r.trips).toHaveLength(MAX_SAVED);
    expect(r.dropped).toBe(3);
  });

  test('🔴 додати: нова — першою; повно — відмова, а не витіснення найстарішої; порожня назва — відмова', () => {
    const one = addSaved([], '  Bled to Zaton  ', TRIP, 5, 'x');
    expect(one.ok && one.trips[0]).toEqual({ id: 'x', name: 'Bled to Zaton', savedAt: 5, draft: TRIP });
    const two = addSaved(one.ok ? one.trips : [], 'Second', TRIP, 6, 'y');
    expect(two.ok && two.trips.map((t) => t.id)).toEqual(['y', 'x']);

    const full = Array.from({ length: MAX_SAVED }, (_, i) => trip(`t${i}`));
    expect(addSaved(full, 'One more', TRIP, 7, 'z')).toEqual({ ok: false, reason: 'full' });
    expect(addSaved([], '   ', TRIP, 7, 'z')).toEqual({ ok: false, reason: 'name' });
    expect(addSaved([], 'x'.repeat(200), TRIP, 7, 'z')).toMatchObject({ ok: true });
  });

  test('видалити: лише названу', () => {
    expect(removeSaved([trip('a'), trip('b')], 'a').map((t) => t.id)).toEqual(['b']);
    expect(removeSaved([trip('a')], 'zzz').map((t) => t.id)).toEqual(['a']);
  });

  test('назва за замовчуванням: перша частина підпису до коми, без «(campsite)», і «and back» для зворотного шляху', () => {
    expect(defaultName({ ...TRIP, roundTrip: false })).toBe('Bled to Camping Zaton');
    expect(defaultName(TRIP)).toBe('Bled to Camping Zaton and back');
    expect(defaultName(EMPTY_DRAFT)).toBe('My trip');
    // Координати — не назва: «46.0 to 44.0» не допомогла б знайти поїздку в списку.
    expect(defaultName({ ...TRIP, from: '46.0, 14.0', fromPlace: null })).toBe('My trip and back');
    expect(defaultName({ ...TRIP, to: '44, 16', toPlace: null, roundTrip: false })).toBe('My trip');
    expect(defaultName({ ...TRIP, from: 'x'.repeat(200) }).length).toBeLessThanOrEqual(60);
  });
});
