import { expect, test } from "@playwright/test";

import {
  AMENITY_KEYS,
  hasChanges,
  loadListings,
  namePatch,
  saveListing,
  type Listing,
} from "@/lib/owner-listings";
import { EmptyView, ListingForm, type Note } from "@/components/owner-listings-view";
import { signInToSave } from "@/components/owner-listings";
import { RETURN_KEY, takeReturn } from "@/lib/return-path";
import { renderClient } from "./render-component";

// CAMP-51 / CAMP-86 — сторінка «мої листинги».

const BASE = "https://api.test";

function storageWith(token: string | null): Storage {
  const data = new Map<string, string>();
  if (token !== null) {
    data.set(
      "camptribe.session",
      JSON.stringify({ token, email: "a@b.de", expiresAt: "2099-01-01T00:00:00.000Z" }),
    );
  }
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

function spy(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetchImpl: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

const LISTING: Listing = {
  slug: "alpenblick",
  name: "Camping Alpenblick",
  path: "/camping/de/bayern/alpenblick",
  overrides: {},
};

test.describe("🔴 прибрати правку — це null, а не порожній рядок", () => {
  test("порожнє поле повертає те, що каже OSM", () => {
    // Порожній рядок записав би кемпінг БЕЗ назви.
    expect(namePatch("   ", "OSM name")).toBeNull();
  });

  test("збіг із OSM — теж нема чого правити", () => {
    // Інакше в колонці лежав би рядок, який виглядає як рішення
    // власника, хоч він нічого не вирішував.
    expect(namePatch("  OSM name ", "OSM name")).toBeNull();
  });

  test("інша назва — це правка", () => {
    expect(namePatch(" Mine ", "OSM name")).toBe("Mine");
  });

  test("кемпінг без назви в OSM: будь-який текст — правка", () => {
    expect(namePatch("Mine", null)).toBe("Mine");
    expect(namePatch("", null)).toBeNull();
  });

  test("порожня правка не надсилається", () => {
    expect(hasChanges({})).toBe(false);
    expect(hasChanges({ name: null })).toBe(true);
  });
});

test.describe("запити", () => {
  test("🔴 обидва несуть Bearer", async () => {
    const list = spy(200, { listings: [LISTING] });
    await loadListings(BASE, list.fetchImpl, storageWith("TK"));
    expect(
      (list.calls[0].init.headers as Record<string, string>).authorization,
    ).toBe("Bearer TK");

    const save = spy(200, { overrides: { name: "Mine" } });
    await saveListing("alpenblick", { name: "Mine" }, BASE, save.fetchImpl, storageWith("TK"));
    expect(
      (save.calls[0].init.headers as Record<string, string>).authorization,
    ).toBe("Bearer TK");
    expect(JSON.parse(String(save.calls[0].init.body))).toEqual({
      slug: "alpenblick",
      patch: { name: "Mine" },
    });
  });

  test("🔴 без сесії жодного виклику", async () => {
    const list = spy(200, { listings: [] });
    expect(await loadListings(BASE, list.fetchImpl, storageWith(null))).toEqual({
      kind: "signed-out",
    });
    expect(list.calls).toHaveLength(0);
  });

  test("тіло не тієї форми — failed, а не порожній список", async () => {
    // Порожній список сказав би людині «у вас немає листингів», хоч ми
    // просто не зрозуміли відповіді.
    const bad = spy(200, { listings: "nope" });
    expect(await loadListings(BASE, bad.fetchImpl, storageWith("TK"))).toEqual({
      kind: "failed",
    });
  });

  test("відмова несе слова сервера", async () => {
    const no = spy(400, { code: "bad_patch", message: "поле «website» власник не редагує" });
    const res = await saveListing("x", { website: "y" }, BASE, no.fetchImpl, storageWith("TK"));
    expect(res).toEqual({ kind: "refused", message: "поле «website» власник не редагує" });
  });

  test("404 на чужий листинг — теж відмова зі словами", async () => {
    const no = spy(404, { code: "not_yours", message: "Not found, or not yours." });
    expect(
      await saveListing("x", { name: "A" }, BASE, no.fetchImpl, storageWith("TK")),
    ).toEqual({ kind: "refused", message: "Not found, or not yours." });
  });
});

test.describe("розмітка", () => {
  test("порожній кабінет пояснює дорогу, а не мовчить", () => {
    const html = renderClient(EmptyView, {});
    expect(html).toContain("Claim the listing");
    expect(html).toContain("OpenStreetMap");
  });

  test("🔴 форма каже, що правка ПЕРЕКРИВАЄ OSM, а не змінює його", () => {
    const html = renderClient(ListingForm, {
      listing: LISTING,
      name: "Camping Alpenblick",
      amenities: {},
      busy: false,
      ready: true,
      dirty: false,
      message: null,
      onName: () => {},
      onAmenity: () => {},
      onSave: () => {},
    });
    expect(html).toContain("instead of what");
    expect(html).toContain("never overwrites it");
  });

  test("усі десять зручностей на екрані, і кожна має «Not known»", () => {
    const html = renderClient(ListingForm, {
      listing: LISTING,
      name: "",
      amenities: {},
      busy: false,
      ready: true,
      dirty: false,
      message: null,
      onName: () => {},
      onAmenity: () => {},
      onSave: () => {},
    });
    for (const k of AMENITY_KEYS) expect(html).toContain(`amenity-${k}`);
    expect((html.match(/Not known/g) ?? []).length).toBe(AMENITY_KEYS.length);
  });

  test("🔴 кемпінг без сторінки не отримує посилання на 404", () => {
    const html = renderClient(ListingForm, {
      listing: { ...LISTING, path: null },
      name: "",
      amenities: {},
      busy: false,
      ready: true,
      dirty: false,
      message: null,
      onName: () => {},
      onAmenity: () => {},
      onSave: () => {},
    });
    expect(html).not.toContain("See the page");
    expect(html).toContain("no public page yet");
  });

  test("без змін кнопка не активна", () => {
    const html = renderClient(ListingForm, {
      listing: LISTING,
      name: "Camping Alpenblick",
      amenities: {},
      busy: false,
      ready: true,
      dirty: false,
      message: null,
      onName: () => {},
      onAmenity: () => {},
      onSave: () => {},
    });
    expect(html).toContain("disabled");
  });
});

// CAMP-227, хвіст після #449 — збереження впало на «не ввійшов».
//
// Шлях читання вже ставив паузу (`pauseForLogin`), шлях збереження писав
// «Sign in again to save.» і на цьому зупинявся: у sessionStorage не
// лягало нічого, і людина, що сама пішла на /login, поверталась на `/`.
test.describe("🔴 збереження на «не ввійшов» — пауза, а не глухий кут", () => {
  /**
   * Сховище однієї вкладки, яке код бачить як `window.sessionStorage`:
   * у Node `window` немає, а `rememberReturn` пише саме туди.
   *
   * 🔴 Без `location` навмисно. Якби шлях збереження спробував перейти
   * (`window.location.assign`, `href = …`), він упав би тут — а не пройшов
   * мовчки, зʼївши чернетку.
   */
  function withTabStorage<T>(run: (store: Storage) => T): T {
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    } as unknown as Storage;
    const g = globalThis as { window?: unknown };
    const had = "window" in g;
    const before = g.window;
    g.window = { sessionStorage: store };
    try {
      return run(store);
    } finally {
      if (had) g.window = before;
      else delete g.window;
    }
  }

  const stuck = (where: { pathname: string; search: string }): Note =>
    withTabStorage(() => {
      let got: Note | null = null;
      signInToSave(where, (n) => (got = n));
      if (got === null) throw new Error("the save path produced no note");
      return got;
    });

  test("🔴 шлях разом із запитом лягає у sessionStorage, і вхід його забере", () => {
    withTabStorage((store) => {
      const notes: Note[] = [];
      signInToSave(
        { pathname: "/account/listings", search: "?spot=alpenblick" },
        (n) => notes.push(n),
      );
      const raw = store.getItem(RETURN_KEY);
      expect(raw, "nothing was remembered").not.toBeNull();
      expect((JSON.parse(raw as string) as { path: unknown }).path).toBe(
        "/account/listings?spot=alpenblick",
      );
      // Те саме читає форма входу — тим самим `takeReturn`.
      expect(takeReturn(store)).toBe("/account/listings?spot=alpenblick");
      expect(notes).toEqual([{ text: expect.any(String), signIn: "/login" }]);
    });
  });

  test("нотатка у виданому HTML веде на вхід посиланням, а не переходом", () => {
    const html = renderClient(ListingForm, {
      listing: LISTING,
      name: "Camping Alpenblick (mine)",
      amenities: {},
      busy: false,
      ready: true,
      dirty: true,
      message: stuck({ pathname: "/account/listings", search: "" }),
      onName: () => {},
      onAmenity: () => {},
      onSave: () => {},
    });
    expect(html).toContain('href="/login"');
    expect(html).toContain("not saved");
    expect(html).toContain("sign in");
    // Чернетка лишається на екрані — саме тому це посилання, а не редирект.
    expect(html).toContain("Camping Alpenblick (mine)");
  });

  test("звичайна нотатка посилання на вхід не має", () => {
    const html = renderClient(ListingForm, {
      listing: LISTING,
      name: "",
      amenities: {},
      busy: false,
      ready: true,
      dirty: false,
      message: { text: "Saved." },
      onName: () => {},
      onAmenity: () => {},
      onSave: () => {},
    });
    expect(html).toContain("Saved.");
    expect(html).not.toContain('href="/login"');
  });
});
