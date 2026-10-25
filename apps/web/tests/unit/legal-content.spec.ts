import { expect, test } from "@playwright/test";
import { LEGAL_PAGES, legalPage } from "@/lib/legal";
import {
  checkLegalDocument,
  checkPublishedSet,
  legalDocument,
  legalSlugs,
} from "@/lib/legal-content";
import { PAGE_REVALIDATE_SECONDS, PAGE_TAG } from "@/lib/page-content";

// 🔴 CAMP-365 — СТОРОЖ: ПРАВОВИЙ ДОКУМЕНТ, ЯКОГО НЕМАЄ АБО ЧИЄ ТІЛО
// ПОРОЖНЄ, ЗУПИНЯЄ ЗБІРКУ І НАЗИВАЄ СЕБЕ.
//
// Порожній правовий документ на правовій адресі читається як «у них немає
// умов», і це гірше за відсутню адресу. Тому тут перевіряється не «чи
// функція кидає», а КОЖЕН спосіб, яким документ може бути зіпсований, і що
// повідомлення НАЗИВАЄ документ: «збірка впала» без імені — це година
// пошуку, якої сторож існує, щоб не було.
//
// 🔴 КОРПУС НЕ ДІЛИТЬ ПОЛЕ З ТИМ, ЩО МІРЯЄ. Добрий документ тут — літерал із
// власним тілом, а не взятий із міграції чи реєстру. З реєстру беруться лише
// версія й дата — бо саме їх реєстр і має підтверджувати.

const REG = legalPage("terms")!;

/** Добрий документ у тому вигляді, в якому його віддає API. */
const good = (over: Record<string, unknown> = {}) => ({
  slug: "terms",
  title: "Terms of use",
  summary: "Одне речення, щоб його було видно.",
  version: REG.version,
  effectiveFrom: REG.effectiveFrom,
  body: "## 1. Тест {#t1}\n\nТекст, який читач має побачити.\n",
  ...over,
});

test.describe("checkLegalDocument", () => {
  test("добрий документ проходить і віддає рівно те, що друкує сторінка", () => {
    const doc = checkLegalDocument("terms", good());
    expect(doc).toEqual({
      slug: "terms",
      title: "Terms of use",
      summary: "Одне речення, щоб його було видно.",
      version: REG.version,
      effectiveFrom: REG.effectiveFrom,
      body: "## 1. Тест {#t1}\n\nТекст, який читач має побачити.\n",
    });
  });

  // 🔴 ТІЛО — ГОЛОВНЕ. Кожне «порожнє» окремо: відсутнє поле, `null`, порожній
  // рядок і рядок із самих пробілів та переводів рядка. Перевірка лише
  // `=== ""` лишила б живою мутацію «прибрати trim» — а редактор CMS, що
  // стер текст і лишив пропуск, дає саме такий рядок.
  const EMPTY: Array<[string, unknown]> = [
    ["відсутнє", undefined],
    ["null", null],
    ["порожній рядок", ""],
    ["самі пропуски", "   \n\t  \n"],
    ["лише нерозривний пробіл", " "],
  ];
  for (const [label, body] of EMPTY) {
    test(`🔴 тіло — ${label}: збірка падає й називає документ`, () => {
      const doc = good();
      if (body === undefined) delete (doc as Record<string, unknown>).body;
      else (doc as Record<string, unknown>).body = body;

      expect(() => checkLegalDocument("terms", doc)).toThrow(/«terms»/);
      expect(() => checkLegalDocument("terms", doc)).toThrow(/тіло/);
    });
  }

  test("🔴 повідомлення називає ТОЙ документ, який зіпсований, а не перший", () => {
    // Усі сім у реєстрі; псуємо по одному й вимагаємо власну назву.
    for (const p of LEGAL_PAGES) {
      let said = "";
      try {
        checkLegalDocument(
          p.slug,
          { ...good(), slug: p.slug, version: p.version, effectiveFrom: p.effectiveFrom, body: "" },
          p,
        );
      } catch (e) {
        said = (e as Error).message;
      }
      expect(said, `${p.slug}: сторож не впав`).not.toBe("");
      expect(said).toContain(`«${p.slug}»`);
    }
  });

  // Решта полів, які сторінка друкує: порожнє не малюємо.
  for (const field of ["title", "summary", "version", "effectiveFrom"]) {
    for (const [label, v] of [["відсутнє", undefined], ["порожнє", "  "]] as const) {
      test(`поле «${field}» ${label} — збірка падає й називає документ і поле`, () => {
        const doc = good() as Record<string, unknown>;
        if (v === undefined) delete doc[field];
        else doc[field] = v;
        expect(() => checkLegalDocument("terms", doc)).toThrow(/«terms»/);
        expect(() => checkLegalDocument("terms", doc)).toThrow(
          new RegExp(`«${field}»`),
        );
      });
    }
  }

  test("🔴 чужий документ під тим самим слагом — падіння, а не сторінка", () => {
    expect(() =>
      checkLegalDocument("terms", good({ slug: "privacy" })),
    ).toThrow(/«terms».*«privacy»/);
  });

  test("відповідь, що не є обʼєктом, — падіння з назвою документа", () => {
    for (const bad of [null, [], "terms", 42]) {
      expect(() => checkLegalDocument("terms", bad)).toThrow(/«terms»/);
    }
  });

  // 🔴 ВЕРСІЯ — БО ЇЇ КЛЮЧУЄ ЗГОДА. Розбіжність у БУДЬ-ЯКИЙ бік.
  test("🔴 версія в базі не дорівнює реєстру — падіння з обома значеннями", () => {
    const newer = `${REG.version}.1`;
    expect(() => checkLegalDocument("terms", good({ version: newer }))).toThrow(
      new RegExp(`«terms».*«${newer.replace(/\./g, "\\.")}».*«${REG.version.replace(/\./g, "\\.")}»`),
    );
    expect(() => checkLegalDocument("terms", good({ version: "0.1" }))).toThrow(
      /версія/,
    );
  });

  test("🔴 дата набуття чинності не дорівнює реєстру — падіння", () => {
    expect(() =>
      checkLegalDocument("terms", good({ effectiveFrom: "2020-01-01" })),
    ).toThrow(/дата набуття чинності/);
  });

  test("документ, якого немає в реєстрі, — падіння з назвою", () => {
    expect(() =>
      checkLegalDocument("not-registered", good({ slug: "not-registered" })),
    ).toThrow(/«not-registered»/);
  });

  // Назва й опис із реєстром НЕ звіряються — реєстр годує підвал, і назва в
  // базі, відмінна від підвальної, є виглядом, а не неправдою. Це межа
  // сторожа, записана тестом, щоб її не «виправили» тихо.
  test("назва й опис, відмінні від реєстру, — НЕ привід падати", () => {
    const doc = checkLegalDocument(
      "terms",
      good({ title: "Інша назва", summary: "Інший опис" }),
    );
    expect(doc.title).toBe("Інша назва");
    expect(doc.summary).toBe("Інший опис");
  });
});

test.describe("checkPublishedSet", () => {
  const REGISTERED = ["terms", "privacy", "cookies"];

  test("однакові множини в будь-якому порядку проходять", () => {
    expect(() =>
      checkPublishedSet(["cookies", "terms", "privacy"], REGISTERED),
    ).not.toThrow();
  });

  test("🔴 документ із реєстру, якого CMS не віддала, — падіння з назвою", () => {
    expect(() => checkPublishedSet(["terms", "cookies"], REGISTERED)).toThrow(
      /«privacy»/,
    );
  });

  test("🔴 порожній перелік — падіння, а не збірка без жодної правової сторінки", () => {
    expect(() => checkPublishedSet([], REGISTERED)).toThrow(/«terms»/);
  });

  test("документ у CMS, якого немає в реєстрі, — теж падіння з назвою", () => {
    expect(() =>
      checkPublishedSet([...REGISTERED, "newcomer"], REGISTERED),
    ).toThrow(/«newcomer»/);
  });

  test("обидві розбіжності названі разом, а не по черзі", () => {
    let said = "";
    try {
      checkPublishedSet(["terms", "privacy", "newcomer"], REGISTERED);
    } catch (e) {
      said = (e as Error).message;
    }
    expect(said).toContain("«cookies»");
    expect(said).toContain("«newcomer»");
  });
});

// ---------------------------------------------------------------------------
// Мережа: ті самі правила через `fetch`, який підмінено на час одного тесту.
// ---------------------------------------------------------------------------

type Seen = { url: string; init: Record<string, unknown> };

/** Підмінити глобальний fetch на час одного тесту й завжди повернути. */
async function withFetch(
  impl: (url: string) => Response,
  run: (seen: Seen[]) => Promise<void>,
) {
  const real = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = ((url: string, init: Record<string, unknown> = {}) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(impl(String(url)));
  }) as unknown as typeof fetch;
  try {
    await run(seen);
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const listOf = (slugs: string[]) => ({
  documents: slugs.map((slug) => ({ slug })),
});

test.describe("legalSlugs і legalDocument поверх API", () => {
  const ALL = LEGAL_PAGES.map((p) => p.slug);

  test("перелік: усі сім із реєстру — повертаються", async () => {
    await withFetch(
      () => json(listOf(ALL)),
      async (seen) => {
        expect(await legalSlugs()).toEqual(ALL);
        expect(seen).toHaveLength(1);
        expect(new URL(seen[0].url).pathname).toBe("/legal");
      },
    );
  });

  test("🔴 CMS не віддала один документ — збірка падає й називає його", async () => {
    await withFetch(
      () => json(listOf(ALL.filter((s) => s !== "privacy"))),
      async () => {
        await expect(legalSlugs()).rejects.toThrow(/«privacy»/);
      },
    );
  });

  test("🔴 порожній перелік — не «правових сторінок немає», а падіння", async () => {
    await withFetch(
      () => json(listOf([])),
      async () => {
        await expect(legalSlugs()).rejects.toThrow(/розійшлись із реєстром/);
      },
    );
  });

  test("недосяжний API і відповідь без `documents` — падіння, а не порожній перелік", async () => {
    await withFetch(
      () => json({ error: "boom" }, 500),
      async () => {
        await expect(legalSlugs()).rejects.toThrow(/GET \/legal → 500/);
      },
    );
    await withFetch(
      () => json({}),
      async () => {
        await expect(legalSlugs()).rejects.toThrow(/documents/);
      },
    );
  });

  // 🔴 МІТКА Й ВИТРИМКА ПОВИННІ ДОЇХАТИ ДО ЗАПИТУ. Без мітки `pages` правка в
  // CMS оновлюється лише добовою витримкою: `POST /api/revalidate?tag=pages`
  // не мав би що скидати. Читається те, з чим `fetch` справді викликано.
  test("🔴 запити несуть мітку pages і добову витримку", async () => {
    await withFetch(
      (url) =>
        url.endsWith("/legal")
          ? json(listOf(ALL))
          : json(good()),
      async (seen) => {
        await legalSlugs();
        await legalDocument("terms");
        expect(seen).toHaveLength(2);
        for (const s of seen) {
          const next = s.init.next as { revalidate?: number; tags?: string[] };
          expect(next.tags, `${s.url}: мітки`).toContain(PAGE_TAG);
          expect(next.revalidate, `${s.url}: витримка`).toBe(PAGE_REVALIDATE_SECONDS);
        }
        expect(PAGE_TAG).toBe("pages");
      },
    );
  });

  test("документ: добра відповідь віддає документ, запит іде на /legal/<slug>", async () => {
    await withFetch(
      () => json(good()),
      async (seen) => {
        const doc = await legalDocument("terms");
        expect(doc.body).toContain("Текст, який читач має побачити.");
        expect(new URL(seen[0].url).pathname).toBe("/legal/terms");
      },
    );
  });

  test("🔴 документ: 404 на слаг із реєстру — падіння з назвою, не `null`", async () => {
    await withFetch(
      () => json({ message: "x" }, 404),
      async () => {
        await expect(legalDocument("terms")).rejects.toThrow(/«terms».*404/);
      },
    );
  });

  test("🔴 документ: 200 із порожнім тілом — падіння з назвою, а не порожня сторінка", async () => {
    for (const body of ["", "  \n ", null]) {
      await withFetch(
        () => json(good({ body })),
        async () => {
          await expect(legalDocument("terms")).rejects.toThrow(/«terms»/);
          await expect(legalDocument("terms")).rejects.toThrow(/тіло/);
        },
      );
    }
  });

  test("документ: 500 — падіння, а не «немає»", async () => {
    await withFetch(
      () => json({}, 500),
      async () => {
        await expect(legalDocument("terms")).rejects.toThrow(/«terms».*500/);
      },
    );
  });
});
