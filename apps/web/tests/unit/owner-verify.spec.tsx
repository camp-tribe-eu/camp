import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import {
  HELP_ADDRESS,
  confirmOwnerLink,
  emailLooksUsable,
  startOwnerLink,
  tokenFromSearch,
  type OwnerOutcome,
} from "@/lib/owner-verify";
import {
  OwnerConfirmView,
  OwnerDoneView,
  OwnerEmailView,
  OwnerNoTokenView,
  OwnerSentView,
  ownerMessage,
} from "@/components/owner-verify-view";
import { renderClient } from "./render-component";

// CAMP-505 — «Це мій кемпінг»: сторінка вводу пошти й сторінка з листа.
//
// 🔴 КОЖНЕ ТВЕРДЖЕННЯ ПРО СТОРІНКУ ТУТ — ПРО ВИДАНИЙ HTML (renderClient), а
// не про константу чи клас.

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
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: data.size,
  } as unknown as Storage;
}

function spy(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

test.describe("запит на лист", () => {
  test("🔴 несе Bearer, slug і введену пошту (обрізану) на єдиний маршрут", async () => {
    const { calls, fetchImpl } = spy(202, { accepted: true, message: "x" });
    const out = await startOwnerLink("alpen", "  chef@camp.de ", BASE, fetchImpl, storageWith("TK"));
    expect(out).toEqual({ kind: "accepted" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/spot-claims/by-email`);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer TK");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      slug: "alpen",
      email: "chef@camp.de",
    });
  });

  test("🔴 без сесії запиту НЕ ВІДБУВАЄТЬСЯ", async () => {
    const { calls, fetchImpl } = spy(202, { accepted: true });
    expect(await startOwnerLink("x", "a@b.de", BASE, fetchImpl, storageWith(null))).toEqual({
      kind: "signed-out",
    });
    expect(calls).toHaveLength(0);
  });

  test("🔴 порожня адреса API — жодного виклику", async () => {
    const { calls, fetchImpl } = spy(202, { accepted: true });
    expect(await startOwnerLink("x", "a@b.de", "", fetchImpl, storageWith("TK"))).toEqual({
      kind: "unavailable",
    });
    expect(calls).toHaveLength(0);
  });

  test("401 — «увійди», 400 — відмова зі словами сервера, а без слів — запасний текст", async () => {
    expect(
      await startOwnerLink("x", "a@b.de", BASE, spy(401, {}).fetchImpl, storageWith("TK")),
    ).toEqual({ kind: "signed-out" });
    expect(
      await startOwnerLink(
        "x",
        "a@b.de",
        BASE,
        spy(400, { code: "bad_email", message: "Own words." }).fetchImpl,
        storageWith("TK"),
      ),
    ).toEqual({ kind: "refused", code: "bad_email", message: "Own words." });
    const mute = await startOwnerLink(
      "x",
      "a@b.de",
      BASE,
      spy(400, { code: "bad_email" }).fetchImpl,
      storageWith("TK"),
    );
    expect(ownerMessage(mute)).toContain("email address");
  });

  test("🔴 «прийнято» — лише на 202 із accepted:true, а не на будь-яку 2xx", async () => {
    const out = await startOwnerLink("x", "a@b.de", BASE, spy(200, {}).fetchImpl, storageWith("TK"));
    expect(out.kind).not.toBe("accepted");
  });
});

test.describe("клік «підтвердити»", () => {
  test("🔴 іде POST-ом із токеном у тілі, не в адресі", async () => {
    const { calls, fetchImpl } = spy(200, { confirmed: true, slug: "alpen", name: "Alpenblick" });
    const out = await confirmOwnerLink("T".repeat(43), BASE, fetchImpl, storageWith("TK"));
    expect(out).toEqual({ kind: "confirmed", slug: "alpen", name: "Alpenblick" });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toBe(`${BASE}/spot-claims/by-email/confirm`);
    expect(calls[0].url).not.toContain("T".repeat(43));
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ token: "T".repeat(43) });
  });

  test("недійсне посилання — відмова зі словами, а не порожній екран", async () => {
    const out = await confirmOwnerLink(
      "T".repeat(43),
      BASE,
      spy(400, { code: "link_invalid" }).fetchImpl,
      storageWith("TK"),
    );
    expect(out.kind).toBe("refused");
    expect(ownerMessage(out)).toContain("used");
  });

  test("без сесії — жодного виклику", async () => {
    const { calls, fetchImpl } = spy(200, { confirmed: true });
    expect(await confirmOwnerLink("T".repeat(43), BASE, fetchImpl, storageWith(null))).toEqual({
      kind: "signed-out",
    });
    expect(calls).toHaveLength(0);
  });
});

test.describe("токен з адреси", () => {
  test("бере лише справжній токен", () => {
    const t = "A".repeat(43);
    expect(tokenFromSearch(`?t=${t}`)).toBe(t);
    expect(tokenFromSearch("")).toBe("");
    expect(tokenFromSearch("?t=short")).toBe("");
    expect(tokenFromSearch(`?t=${"A".repeat(43)}%27`)).toBe("");
    expect(tokenFromSearch(`?x=${t}`)).toBe("");
  });

  test("пошта перед відправкою", () => {
    expect(emailLooksUsable("chef@camp.de")).toBe(true);
    for (const bad of ["", "chef", "chef@camp", "a@b.de, c@d.de", "<a@b.de>", "a b@c.de"])
      expect(emailLooksUsable(bad)).toBe(false);
  });
});

test.describe("розмітка (виданий HTML)", () => {
  const noop = () => {};

  test("перший екран каже, яка адреса підійде і яка ні, ДО того як людина її введе", () => {
    const html = renderClient(OwnerEmailView, {
      spot: "alpen",
      email: "",
      busy: false,
      ready: true,
      onEmail: noop,
      onSend: noop,
      message: null,
    });
    expect(html).toContain("website domain");
    expect(html).toContain("Free mail");
    expect(html).toContain("Gmail");
    expect(html).toContain('type="email"');
    expect(html).toContain("Send the link");
    // Запасний шлях названо, і він не губиться:
    expect(html).toContain("/account/claim?spot=alpen&amp;via=osm");
    expect(html).toContain(HELP_ADDRESS);
  });

  test("🔴 кнопка вимкнена, доки не гідратувалось і доки поле порожнє", () => {
    const cold = renderClient(OwnerEmailView, {
      spot: "s", email: "a@b.de", busy: false, ready: false,
      onEmail: noop, onSend: noop, message: null,
    });
    expect(cold).toContain("disabled");
    const empty = renderClient(OwnerEmailView, {
      spot: "s", email: "  ", busy: false, ready: true,
      onEmail: noop, onSend: noop, message: null,
    });
    expect(empty).toMatch(/<button[^>]*disabled/);
  });

  test("🔴 після відправки екран НЕ каже «лист надіслано», а каже «якщо підійшла» і куди писати", () => {
    const html = renderClient(OwnerSentView, { spot: "alpen" });
    expect(html).toContain("If that address belongs to");
    expect(html).toContain("could not confirm you automatically");
    expect(html).toContain(`mailto:${HELP_ADDRESS}`);
    expect(html).not.toMatch(/has been sent|was sent|we sent/i);
  });

  test("🔴 сторінка з листа сама нічого не підтверджує: є кнопка й слова про це", () => {
    const html = renderClient(OwnerConfirmView, {
      busy: false, ready: true, onConfirm: noop, message: null,
    });
    expect(html).toContain("Opening it changed nothing");
    expect(html).toContain("Yes, I manage this campsite");
    expect(html).toContain("<button");
  });

  test("🔴 готово обіцяє лише статус і веде до списку, не обіцяє правок", () => {
    const html = renderClient(OwnerDoneView, { name: "Alpenblick" });
    expect(html).toContain("Alpenblick is confirmed as yours");
    expect(html).toContain("/account/listings");
    expect(html).not.toMatch(/edit|photo|price/i);
  });

  test("без токена сторінка не малює кнопки, а веде назад", () => {
    const html = renderClient(OwnerNoTokenView, {});
    expect(html).not.toContain("<button");
    expect(html).toContain("This is my campsite");
  });

  test("відмова без тексту не лишає порожнього повідомлення", () => {
    const refused: OwnerOutcome = { kind: "refused", code: "x", message: "" };
    expect(ownerMessage(refused)).not.toBe("");
    expect(ownerMessage({ kind: "accepted" })).toBeNull();
  });
});

test.describe("сторінки", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  test("🔴 кнопка на сторінці кемпінгу веде у форму й не залежить від OSM-пошти", () => {
    const src = read("src/app/camping/[country]/[region]/[slug]/page.tsx");
    const fn = src.slice(src.indexOf("function ClaimListing"), src.indexOf("function Contact("));
    expect(fn).toContain("This is my campsite");
    expect(fn).toContain("/account/claim?spot=");
    // Показується і за сайтом, а не лише за поштою.
    expect(fn).toMatch(/spot\.website/);
  });

  test("🔴 форма входить у паузу входу, а не в глухий кут", () => {
    const src = read("src/components/owner-verify-form.tsx");
    expect(src.match(/pauseForLogin\(/g)?.length).toBe(2);
    // Жодного `?next=`: адреса повернення береться лише з того, де людина стоїть.
    expect(src).not.toMatch(/next=/);
  });
});
