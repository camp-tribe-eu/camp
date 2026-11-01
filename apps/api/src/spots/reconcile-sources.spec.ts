import {
  AUTO_LINK_IDENTITY,
  CLAIMED_BY_OUTSIDE_RECORD_SQL,
  RULE_ID,
  complements,
  identityOf,
  proposeLinks,
  splitByIdentity,
  writeLinks,
} from './reconcile-sources';
import type { PairRow, Proposal, SpotRow } from './reconcile-sources';

function row(over: Partial<SpotRow> & { id: string }): SpotRow {
  return {
    osm_ref: null,
    name: null,
    lat: 44.1,
    lon: 3.08,
    slug: over.id,
    country: 'FR',
    stars: null,
    has_contact: false,
    website: null,
    email: null,
    has_description: false,
    ...over,
  };
}

/** Metres east, roughly, at 44°N. */
const east = (m: number) =>
  3.08 + m / (111_320 * Math.cos((44.1 * Math.PI) / 180));

describe('proposeLinks', () => {
  const osm = row({ id: 'osm-1', osm_ref: 'a216', name: 'Les 2 Rivières' });
  const other = row({
    id: 'dt-1',
    name: 'Camping 2 Rivières',
    lon: east(71),
    stars: 3,
  });
  const pair: PairRow = { a: osm, b: other, metres: 71 };

  it('links a pair the shared matcher calls the same campsite', () => {
    const out = proposeLinks([pair], new Set());
    expect(out.link).toHaveLength(1);
    expect(out.review).toHaveLength(0);
  });

  it('always makes the OSM row the primary, whichever side it arrived on', () => {
    // 🔴 The direction is what makes a chain impossible: an OSM row can
    // never be a secondary, so the read side never walks more than one
    // hop. Swapping the sides of the pair must not change it.
    for (const p of [pair, { a: other, b: osm, metres: 71 } as PairRow]) {
      const out = proposeLinks([p], new Set());
      expect(out.link[0].primary.id).toBe('osm-1');
      expect(out.link[0].secondary.id).toBe('dt-1');
    }
  });

  it('leaves a pair the matcher is unsure about for a person', () => {
    // 🔴 350 м, а не 250: від CAMP-277 однакова назва тягнеться до 300 м,
    // і 250 тепер — звʼязок, а не непевність. Намір тесту («непевне йде
    // людині») лишився; змінилась межа, за якою починається непевність,
    // і фікстура переїхала за неї, а не тест переписався під код.
    const far = { ...other, lon: east(350) };
    const out = proposeLinks([{ a: osm, b: far, metres: 350 }], new Set());
    expect(out.link).toHaveLength(0);
    expect(out.review).toHaveLength(1);
  });

  it('🔴 CAMP-277: та сама назва за 250 м — це один кемпінг', () => {
    // Те, чим 250 м стало. Тримається поряд із випадком вище навмисно:
    // разом вони показують межу з обох боків, і зсув стелі зламає один
    // із двох, а не пройде непоміченим.
    const far = { ...other, lon: east(250) };
    const out = proposeLinks([{ a: osm, b: far, metres: 250 }], new Set());
    expect(out.link).toHaveLength(1);
    expect(out.review).toHaveLength(0);
  });

  it('keeps two differently named campsites apart', () => {
    const elsewhere = row({
      id: 'dt-2',
      name: 'Camping du Viaduc',
      lon: east(60),
    });
    const out = proposeLinks([{ a: osm, b: elsewhere, metres: 60 }], new Set());
    expect(out.link).toHaveLength(0);
    expect(out.apart).toBe(1);
  });

  it('chooses between two candidates instead of linking both', () => {
    // 🔴 Asked pair by pair, the matcher would happily call two
    // different OSM rows "the same campsite as this one" and we would
    // write two links for one row — which the unique index would then
    // reject halfway through a run. Grouping is what prevents it.
    const decoy = row({
      id: 'osm-2',
      osm_ref: 'a999',
      name: 'Les 2 Rivières',
      lon: east(30),
    });
    const out = proposeLinks(
      [pair, { a: decoy, b: other, metres: 41 }],
      new Set(),
    );
    expect(out.link).toHaveLength(1);
  });

  it('never re-proposes a pair the table has already judged', () => {
    // 🔴 Including one a person has UNDONE. If the reconciler put a
    // rejected link back on its next run, the undo would last until
    // Monday and "reversible" would be a word rather than a property.
    const out = proposeLinks([pair], new Set(['osm-1|dt-1']));
    expect(out.link).toHaveLength(0);
    expect(out.alreadyJudged).toBe(1);
  });

  it('does not link a row to itself through a duplicate pair', () => {
    const out = proposeLinks([pair, pair], new Set());
    expect(out.link).toHaveLength(1);
  });

  it('gives one campsite to one record, and the loser to a person', () => {
    // 🔴 Grouping by the non-OSM row answers "which campsite is this
    // record?" once per record — so two DATAtourisme rows beside one OSM
    // campsite could each name it and BOTH links were proposed. The
    // unique index would then reject the second halfway through a run.
    // DATAtourisme listing a campsite and its motorhome pitch as two
    // POIs is the ordinary way in.
    const second = row({
      id: 'dt-2',
      name: 'Les 2 Rivières',
      lon: east(120),
    });
    const out = proposeLinks(
      [pair, { a: osm, b: second, metres: 120 }],
      new Set(),
    );
    expect(out.link).toHaveLength(1);
    expect(out.review).toHaveLength(1);
    // The closer record wins, whichever order they arrived in.
    expect(out.link[0].secondary.id).toBe('dt-1');
    expect(out.review[0].secondary.id).toBe('dt-2');
  });

  it('sends a record to a person when the table already claims that campsite', () => {
    // 🔴 After the first --apply, `judged` skips the existing pair before
    // it can claim its primary — so a second record found no rival, was
    // proposed, and hit the unique index. The savepoint stopped the
    // crash, but the record was reported as a database refusal instead of
    // as a question, on every run for ever.
    const second = row({ id: 'dt-2', name: 'Les 2 Rivières', lon: east(120) });
    const out = proposeLinks(
      [{ a: osm, b: second, metres: 120 }],
      new Set(),
      new Set(['osm-1']),
    );
    expect(out.link).toHaveLength(0);
    expect(out.review).toHaveLength(1);
    expect(out.review[0].why).toContain('already linked');
  });

  it('sends a record to a person when IT already sits behind another campsite', () => {
    // 🔴 The mirror of the case above, found 01.11.2026 on the first
    // unattended-shaped run: 10 of 55 auto-tier links were refused by
    // the unique index on live secondaries, because the DATAtourisme row
    // was already linked to ONE OSM row and a SECOND OSM row 30–250 m
    // away matched it too. Which OSM row is the campsite is a person's
    // call; a timer that fails on it every week is an alarm nobody hears.
    const out = proposeLinks([pair], new Set(), new Set(), new Set(['dt-1']));
    expect(out.link).toHaveLength(0);
    expect(out.review).toHaveLength(1);
    expect(out.review[0].why).toBe(
      'this record is already linked to another campsite',
    );
  });

  it('picks the same winner whichever order the pairs arrive in', () => {
    const second = row({ id: 'dt-2', name: 'Les 2 Rivières', lon: east(120) });
    const forwards = proposeLinks(
      [pair, { a: osm, b: second, metres: 120 }],
      new Set(),
    );
    const backwards = proposeLinks(
      [{ a: osm, b: second, metres: 120 }, pair],
      new Set(),
    );
    expect(forwards.link[0].secondary.id).toBe(backwards.link[0].secondary.id);
  });
});

/**
 * Рішення 28.10.2026: без нагляду пишеться лише те, у чому впевнені.
 * Матчер каже «один кемпінг» за назвою й відстанню; третя вісь — домен
 * сайту чи пошти, поле, якого матчер не читає. Два тести нижче тримають
 * межу з обох боків на ОДНАКОВИХ назві й відстані (sim 1, 71 м), щоб
 * різниця була лише в домені: пара вище порога зливається, пара нижче —
 * ні. Опустити поріг до старого (авто = усе, що сказав матчер) — і
 * другий тест червоніє.
 */
describe('splitByIdentity — the third axis', () => {
  const osm = row({
    id: 'osm-1',
    osm_ref: 'a216',
    name: 'Les 2 Rivières',
    website: 'https://www.camping-2-rivieres.fr/',
  });
  const sameDomain = row({
    id: 'dt-1',
    name: 'Camping 2 Rivières',
    lon: east(71),
    website: 'camping-2-rivieres.fr/tarifs',
  });
  const otherDomain = { ...sameDomain, website: 'https://autre-camping.fr' };
  const silent = { ...sameDomain, website: null };

  const verdictOf = (other: SpotRow) =>
    proposeLinks([{ a: osm, b: other, metres: 71 }], new Set());

  it('auto-links the pair the matcher AND the domain both call one campsite', () => {
    const out = verdictOf(sameDomain);
    expect(out.link).toHaveLength(1);
    // The two confidences, as numbers: the matcher's, then the gate's.
    expect(out.link[0].similarity).toBe(1);
    expect(out.link[0].metres).toBe(71);
    expect(identityOf(out.link[0])).toBe('agree');
    const { auto, held } = splitByIdentity(out.link);
    expect(auto).toHaveLength(1);
    expect(held).toHaveLength(0);
  });

  it('holds back the SAME pair when the domains differ — sim 1, 71 m, and still no', () => {
    const out = verdictOf(otherDomain);
    // The matcher is as sure as it ever gets …
    expect(out.link).toHaveLength(1);
    expect(out.link[0].similarity).toBe(1);
    expect(out.link[0].metres).toBe(71);
    // … and it is not written, because the independent axis says no.
    const { auto, held } = splitByIdentity(out.link);
    expect(auto).toHaveLength(0);
    expect(held).toHaveLength(1);
    expect(held[0].identity).toBe('disagree');
  });

  it('holds back a pair where one side names nobody — silence is not a weak yes', () => {
    const { auto, held } = splitByIdentity(verdictOf(silent).link);
    expect(auto).toHaveLength(0);
    expect(held[0].identity).toBe('none');
  });

  it('the gate is agreement, not "anything but disagreement"', () => {
    expect(AUTO_LINK_IDENTITY).toBe('agree');
  });

  it('reads the email as a second way of naming oneself', () => {
    const byMail = row({
      id: 'osm-2',
      osm_ref: 'a217',
      name: 'Les 2 Rivières',
      website: null,
      email: 'contact@camping-2-rivieres.fr',
    });
    expect(identityOf({ primary: byMail, secondary: sameDomain })).toBe(
      'agree',
    );
  });

  it('names the third axis in the rule it stamps on every row', () => {
    // So old rows (written by the matcher alone) and new ones can be
    // told apart in the table without opening the code.
    expect(RULE_ID).toMatch(/\+domain$/);
  });
});

/**
 * 🔴 Оборотність — це РЯДОК у spot_links, і нічого більше. Тест тримає
 * записувача фальшивим клієнтом, який лише записує, що в нього просили:
 * один INSERT у spot_links на звʼязок, з обома id, відстанню, схожістю
 * і правилом — усім, що треба арбітру, щоб побачити й розчепити, — і
 * жодного слова про camping_spots. Зробити злиття незворотним (сховати
 * дубль через UPDATE camping_spots, або прибрати правило з рядка) —
 * і цей тест червоніє.
 */
describe('writeLinks leaves the trace an undo needs', () => {
  const proposal: Proposal = {
    primary: row({ id: 'osm-1', osm_ref: 'a216', name: 'Les 2 Rivières' }),
    secondary: row({ id: 'dt-1', name: 'Camping 2 Rivières' }),
    metres: 71,
    similarity: 1,
    why: 'same name, same place',
  };

  function recorder(failOn?: (sql: string, params?: unknown[]) => boolean) {
    const calls: { sql: string; params?: unknown[] }[] = [];
    return {
      calls,
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params });
        if (failOn?.(sql, params)) throw new Error('duplicate key value');
        return { rowCount: /^\s*INSERT/i.test(sql) ? 1 : null };
      },
    };
  }

  it('writes exactly one spot_links row per link, carrying what an undo needs', async () => {
    const db = recorder();
    const r = await writeLinks(db, [proposal]);
    expect(r.written).toBe(1);
    expect(r.refused).toHaveLength(0);
    const inserts = db.calls.filter((c) => /^\s*INSERT/i.test(c.sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/INSERT\s+INTO\s+spot_links/i);
    expect(inserts[0].sql).toMatch(
      /\(primary_id,\s*secondary_id,\s*metres,\s*name_similarity,\s*rule\)/i,
    );
    expect(inserts[0].params).toEqual(['osm-1', 'dt-1', 71, 1, RULE_ID]);
  });

  it('never touches a campsite row — hiding happens at read time, from the link', async () => {
    const db = recorder();
    await writeLinks(db, [proposal]);
    for (const c of db.calls) expect(c.sql).not.toMatch(/camping_spots/i);
    for (const c of db.calls) expect(c.sql).not.toMatch(/^\s*(UPDATE|DELETE)/i);
  });

  it('a row the database refuses costs one row, not the run', async () => {
    const second: Proposal = {
      ...proposal,
      secondary: row({ id: 'dt-2', name: 'Les 2 Rivières', lon: east(120) }),
      metres: 120,
    };
    const db = recorder((sql, params) => params?.[1] === 'dt-1');
    const r = await writeLinks(db, [proposal, second]);
    expect(r.written).toBe(1);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0]).toContain('duplicate key');
    expect(db.calls.some((c) => /ROLLBACK TO SAVEPOINT/i.test(c.sql))).toBe(
      true,
    );
  });

  it('opens no transaction of its own, so a rehearsal can roll it back', async () => {
    const db = recorder();
    await writeLinks(db, [proposal]);
    for (const c of db.calls)
      expect(c.sql).not.toMatch(/^\s*(BEGIN|COMMIT)\b/i);
  });
});

describe('complements', () => {
  const make = (primary: Partial<SpotRow>, secondary: Partial<SpotRow>) => ({
    primary: row({ id: 'a', osm_ref: 'a1', ...primary }),
    secondary: row({ id: 'b', ...secondary }),
    metres: 50,
    similarity: 1,
    why: '',
  });

  it('sees the case the card is about: contacts here, stars there', () => {
    const c = complements(make({ has_contact: true }, { stars: 3 }));
    expect(c.gains).toBe(true);
    expect(c.bothContactAndStars).toBe(true);
  });

  it('counts a website as a way of being reachable', () => {
    const c = complements(make({ website: 'https://x.fr' }, { stars: 3 }));
    expect(c.bothContactAndStars).toBe(true);
  });

  it('says a pair gains nothing when neither side holds anything', () => {
    const c = complements(make({}, {}));
    expect(c.gains).toBe(false);
    expect(c.bothContactAndStars).toBe(false);
  });
});

/**
 * CAMP-281. The behaviour lives in how the SET is built, not in
 * `proposeLinks`, so this holds the text. The reason it is worth holding
 * at all: with the old query every OSM area carrying its own twin was
 * declared "already linked", and the shape the link invariants call
 * legal could never be created.
 */
describe('CLAIMED_BY_OUTSIDE_RECORD_SQL', () => {
  it('counts only secondaries that are NOT OSM rows', () => {
    expect(CLAIMED_BY_OUTSIDE_RECORD_SQL).toContain('s.osm_ref IS NULL');
    expect(CLAIMED_BY_OUTSIDE_RECORD_SQL).toContain('l.unlinked_at IS NULL');
  });

  // 🔴 There was a second test here asserting the old query's text was
  // GONE. It could never have matched — the new constant starts
  // `SELECT l.primary_id` — and worse, a review showed the whole
  // behaviour could be reverted (`AND (s.osm_ref IS NULL OR TRUE)`)
  // with this file still green. What holds the behaviour is
  // verify-folds.ts, which plants an area carrying only its twin and
  // checks it is not counted, then adds an outside record and checks it
  // is. This file holds the shape; that one holds the meaning.
});
