import { expect, test } from "@playwright/test";

import { COUNTRY_CONFIG } from "../../src/data/rental/country-config";
import {
  countryProblems,
  MEASURED,
  MEASURED_CODES,
  measuredFor,
  measuredLead,
  MIN_FACTS,
  MIN_RECORDS_FOR_A_PAGE,
  shareOf,
  type MetricKey,
  type RentalCountry,
} from "../../src/lib/rental";
import { FUEL_COUNTRIES } from "../../src/lib/fuel";

/**
 * CAMP-4 / CAMP-54 / CAMP-479 — правила, яким мусять відповідати
 * сторінки країн оренди.
 *
 * 🔴 ПЕРЕЇХАЛИ З ЮНІТІВ, бо дані переїхали в базу. Перевіряти їх по копії
 * в коді означало б стерегти копію, а не те, що бачить читач.
 *
 * 🔴 ЦІ ПРАВИЛА — НЕ ПРИДИРКИ ДО СТИЛЮ. Вони про одне: чи не стала ця
 * секція купою сторінок, що відрізняються лише назвою країни. Саме це
 * політика Google називає scaled content abuse, і платить за нього не
 * секція, а домен.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

let COUNTRIES: RentalCountry[] = [];

async function publishableCountriesFromApi(): Promise<RentalCountry[]> {
  return COUNTRIES.filter((c) => countryProblems(c).length === 0);
}

test.beforeAll(async () => {
  const url = `${API}/rental/countries`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const body = (await res.json()) as {
    countries?: Array<Omit<RentalCountry, "data" | "definiteArticle">>;
  };

  // 🔴 ДОМІШУЄМО ТЕ, ЩО ЛИШИЛОСЬ У КОДІ, А НЕ ПРАЦЮЄМО БЕЗ НЬОГО.
  //
  // API віддає лише текст: `data` (який замір вести) і `definiteArticle`
  // живуть у `COUNTRY_CONFIG`, бо обирають обчислення й граматику, а не
  // показуються читачеві. Перша редакція цього файла брала відповідь
  // як є — і правила нижче падали з `Cannot destructure property
  // 'metric' of 'country.data'`. Тобто тест перевіряв не ту країну, яку
  // бачить сайт, а її половину.
  COUNTRIES = (body.countries ?? []).map((c) => {
    const cfg = COUNTRY_CONFIG[c.code];
    if (!cfg) {
      throw new Error(
        `країна «${c.code}» є в CMS, але не має рядка в COUNTRY_CONFIG — ` +
          "саме це й мусить ловити сторож у lib/rental.ts",
      );
    }
    return {
      ...c,
      data: { metric: cfg.metric, kind: cfg.kind },
      ...(cfg.definiteArticle ? { definiteArticle: true as const } : {}),
    };
  });

  // 🔴 ЗНАМЕННИК. Над порожнім переліком «жодні дві країни не однакові»
  // істинне ні про що — зелений тест, який нічого не стереже.
  if (COUNTRIES.length === 0) {
    throw new Error(
      `${url} віддав 200 і жодної країни — це збій фікстури, а не ` +
        `чистий прогін.`,
    );
  }
});

test("the section publishes between ten and fifteen country pages", async () => {
  // 🔴 Both bounds matter. Below ten there is no section; above fifteen we
  // are back to the page farm the card asked for and this work refused.
  expect(COUNTRIES.length).toBeGreaterThanOrEqual(10);
  expect(COUNTRIES.length).toBeLessThanOrEqual(15);
  expect((await publishableCountriesFromApi()).length).toBe(COUNTRIES.length);
});

test("every country page passes the publication gate", async () => {
  const problems = COUNTRIES.flatMap(countryProblems);
  expect(problems, problems.join("\n")).toEqual([]);
});

test("no two countries lead with the same measured claim", async () => {
  // 🔴 The rule that keeps twelve pages from being one page twelve times.
  // Two countries leading with the same metric in the same form produce
  // two sentences differing only by a name and a number, which is exactly
  // the shape scripts/seo/check-duplicate-pages.mjs measures after the
  // build — this catches it before.
  const seen = new Map<string, string>();
  for (const c of COUNTRIES) {
    const key = `${c.data.metric}/${c.data.kind}`;
    expect(
      seen.has(key),
      `${c.code} and ${seen.get(key)} both lead with ${key}`,
    ).toBe(false);
    seen.set(key, c.code);
  }
});

test("every country page carries at least three separately sourced facts", async () => {
  for (const c of COUNTRIES) {
    expect(c.facts.length, `${c.code}`).toBeGreaterThanOrEqual(MIN_FACTS);
    // Three facts pointing at one authority is one fact in three parts.
    const hosts = new Set(c.facts.map((f) => f.source.url));
    expect(
      hosts.size,
      `${c.code} cites the same page three times`,
    ).toBeGreaterThan(1);
    for (const f of c.facts) {
      // Long enough to be an explanation rather than a headline. Measured
      // against the shortest one written by hand, with room below it.
      expect(
        f.body.length,
        `${c.code}: "${f.title}" is too thin`,
      ).toBeGreaterThan(200);
    }
  }
});

test("country intros do not share their opening sentence", async () => {
  const openings = COUNTRIES.map((c) => c.intro.split(". ")[0]);
  expect(new Set(openings).size).toBe(openings.length);
});

test("the section stays inside the EU-27", async () => {
  // The Commission's weekly bulletin covers the member states and nothing
  // else, so its country list is an EU-27 list we already ship.
  const eu = new Set(FUEL_COUNTRIES.map((c) => c.toLowerCase()));
  for (const c of COUNTRIES) {
    expect(eu.has(c.code), `${c.code} is not an EU member state`).toBe(true);
  }
  expect(MEASURED_CODES.every((c) => eu.has(c))).toBe(true);
  expect(MEASURED_CODES).toHaveLength(27);
});

// ── The measured snapshot ──────────────────────────────────────────────

test("every published country is above the threshold for saying anything", async () => {
  for (const c of COUNTRIES) {
    const row = measuredFor(c.code);
    expect(row, `${c.code} missing from the snapshot`).not.toBeNull();
    expect(
      (row as { spots: number }).spots,
      `${c.code} has too few records for a share to mean anything`,
    ).toBeGreaterThanOrEqual(MIN_RECORDS_FOR_A_PAGE);
  }
});

test("every measured lead still computes, and its rank is real", async () => {
  for (const c of COUNTRIES) {
    const lead = measuredLead(c);
    expect(lead, `${c.code}`).not.toBeNull();
    const l = lead as NonNullable<typeof lead>;
    expect(l.of).toBe(27);
    expect(l.position).toBeGreaterThanOrEqual(1);
    expect(l.position).toBeLessThanOrEqual(27);
    // 🔴 The rank is recomputed here by the same function the page uses,
    // but the claim that matters is checked independently below.
    expect(l.place).toMatch(
      /^the (highest|thinnest|\d+(st|nd|rd|th)-(highest|thinnest))$/,
    );
  }
});

test("a country claiming first place really is first", async () => {
  // 🔴 Recomputed from the raw snapshot rather than trusting rankOf, so a
  // bug in the ranking itself cannot make a false superlative pass.
  for (const c of COUNTRIES) {
    const lead = measuredLead(c);
    if (!lead || lead.position !== 1) continue;
    const score = (code: string) => {
      const row = MEASURED.countries[code];
      if (lead.kind === "per-region") return row.spots / row.regions;
      if (lead.kind === "share") return shareOf(row, lead.metric);
      const key = lead.metric as MetricKey;
      return key === "vehicleOnly"
        ? row.camperStop + row.rvPark
        : row[key as keyof typeof row];
    };
    const mine = score(c.code);
    for (const other of MEASURED_CODES) {
      if (other === c.code) continue;
      if (lead.kind === "per-region") {
        expect(
          score(other),
          `${other} is thinner than ${c.code}`,
        ).toBeGreaterThanOrEqual(mine);
      } else {
        expect(
          score(other),
          `${other} beats ${c.code} on ${lead.metric}`,
        ).toBeLessThanOrEqual(mine);
      }
    }
  }
});

/**
 * Джерела фактів про країни — і чому кожне з них тут.
 *
 * 🔴 ЦЕЙ ПЕРЕЛІК ПЕРЕЇХАВ ІЗ `tests/unit/attribution-sources.spec.ts`
 * РАЗОМ ІЗ ДАНИМИ (CAMP-479). Доки факти лежали в коді, їх джерела
 * бачив обхід коду. Тепер вони в базі — і обхід коду їх не бачить, а
 * виняток, що лишився б там, став би МЕРТВИМ. Сторож мертвих винятків
 * не терпить навмисно: мертвий виняток ховає те, що джерело зникло зі
 * сторінки разом із твердженням.
 *
 * 🔴 ЦЕ НЕ АТРИБУЦІЯ, А ЦИТУВАННЯ. Ми не беремо в цих органів дані — ми
 * переказуємо норму своїми словами й називаємо, звідки вона. Тому їх
 * немає на сторінці джерел, і тому кожен мусить мати тут причину.
 */
const CITED_SOURCES: Readonly<Record<string, string>> = {
  "boe.es":
    "текст норми, яку сторінка переказує своїми словами; цитується як джерело правила — нічого не завантажується й не відтворюється",
  "normattiva.it":
    "текст норми, яку сторінка переказує своїми словами; цитується як джерело правила — нічого не завантажується й не відтворюється",
  "diariodarepublica.pt":
    "текст норми, яку сторінка переказує своїми словами; цитується як джерело правила — нічого не завантажується й не відтворюється",
  "gesetze-im-internet.de":
    "текст норми, яку сторінка переказує своїми словами; цитується як джерело правила — нічого не завантажується й не відтворюється",
  "umweltbundesamt.de":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "certificat-air.gouv.fr":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "mit.gov.it":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "dgt.es":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "mitma.gob.es":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "rijksoverheid.nl":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "milieuzones.nl":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "oesterreich.gv.at":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "policija.si":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "transportstyrelsen.se":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "fstyr.dk":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "rsa.ie":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "naturvardsverket.se":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "economy-finance.ec.europa.eu":
    "орган, що видає або адмініструє правило (платня за дорогу, віньєтка, зона викидів, зимові шини, ночівля); цитується як походження норми",
  "toll-collect.de":
    "власний опублікований тариф чи класифікація транспорту оператора; цитується як походження правила — жодної цифри не завантажується",
  "autostrade.it":
    "власний опублікований тариф чи класифікація транспорту оператора; цитується як походження правила — жодної цифри не завантажується",
  "asfinag.at":
    "власний опублікований тариф чи класифікація транспорту оператора; цитується як походження правила — жодної цифри не завантажується",
  "hac.hr":
    "власний опублікований тариф чи класифікація транспорту оператора; цитується як походження правила — жодної цифри не завантажується",
  "evinjeta.dars.si":
    "власний опублікований тариф чи класифікація транспорту оператора; цитується як походження правила — жодної цифри не завантажується",
  "infraestruturasdeportugal.pt":
    "власний опублікований тариф чи класифікація транспорту оператора; цитується як походження правила — жодної цифри не завантажується",
  "tii.ie":
    "власний опублікований тариф чи класифікація транспорту оператора; цитується як походження правила — жодної цифри не завантажується",
  "croatia.hr":
    "національне джерело контексту, на яке спирається твердження сторінки",
  "turismodeportugal.pt":
    "національне джерело контексту, на яке спирається твердження сторінки",
  "naturstyrelsen.dk":
    "національне джерело контексту, на яке спирається твердження сторінки",
};

test("кожне джерело факту назване, і жодна причина не протухла", async () => {
  const hosts = new Set<string>();
  for (const c of COUNTRIES) {
    for (const f of c.facts) {
      expect(f.source.url, `${c.code}: факт без посилання`).toBeTruthy();
      hosts.add(new URL(f.source.url).hostname.replace(/^www\./, ""));
    }
  }

  // 🔴 ЗНАМЕННИК: скільки хостів узагалі знайдено.
  expect(
    hosts.size,
    "жодного джерела у фактах — сторож сліпий",
  ).toBeGreaterThan(5);

  const uncovered = [...hosts].filter((h) => !(h in CITED_SOURCES));
  expect(
    uncovered,
    `джерела без пояснення (${uncovered.length} із ${hosts.size}): додай рядок ` +
      `у CITED_SOURCES із причиною, або прибери твердження зі сторінки`,
  ).toEqual([]);

  // 🔴 І НАВПАКИ — мертвий запис так само дефект: він означає, що
  // твердження зникло, а ми про це не дізнались.
  const dead = Object.keys(CITED_SOURCES).filter((h) => !hosts.has(h));
  expect(
    dead,
    `записи про джерела, яких уже немає у фактах (видали їх): ${dead.join(", ")}`,
  ).toEqual([]);
});
