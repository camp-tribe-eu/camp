import { expect, test } from "@playwright/test";

import {
  REFUSAL_TEXT,
  canAskAgain,
  codeLooksComplete,
  confirmClaim,
  nextStep,
  normaliseCode,
  startClaim,
  type ClaimOutcome,
} from "@/lib/spot-claim";
import { AskView, CodeView, DoneView, messageFor } from "@/components/claim-view";
import { renderClient } from "./render-component";

// CAMP-51 — сторінка заявки на володіння кемпінгом.

const BASE = "https://api.test";

/** Сховище з сесією, як його кладе вхід. */
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

type Seen = { url: string; init: RequestInit };

function spy(status: number, body: unknown) {
  const calls: Seen[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

test.describe("код із листа", () => {
  test("пробіли, дефіси й регістр не рахуються — як і в API", () => {
    expect(normaliseCode(" ab-cd ef ")).toBe("ABCDEF");
    expect(codeLooksComplete("abcd-2345")).toBe(true);
    expect(codeLooksComplete("abcd234")).toBe(false);
  });
});

test.describe("🔴 відмова не відкочує крок", () => {
  const refused = (code: string): ClaimOutcome => ({
    kind: "refused",
    code,
    message: "x",
  });

  test("помилка в коді лишає людину на введенні коду", () => {
    // Інакше кожна помилка коштує нового листа чужому кемпінгу, і три
    // помилки вичерпують денну межу на цей кемпінг.
    expect(nextStep("code", refused("wrong_code"))).toBe("code");
    expect(nextStep("code", refused("expired"))).toBe("code");
    expect(nextStep("code", refused("burned"))).toBe("code");
  });

  test("а «заявки немає» повертає на початок — на кроці коду робити нічого", () => {
    expect(nextStep("code", refused("no_pending"))).toBe("ask");
  });

  test("успіх веде вперед", () => {
    expect(
      nextStep("ask", { kind: "sent", sentTo: "i***@c***.de", expiresAt: "" }),
    ).toBe("code");
    expect(nextStep("code", { kind: "confirmed" })).toBe("done");
  });

  test("мережа, що впала, нікуди не веде", () => {
    expect(nextStep("code", { kind: "failed" })).toBe("code");
    expect(nextStep("ask", { kind: "failed" })).toBe("ask");
  });

  test("«надіслати ще раз» пропонується лише коли старий код мертвий", () => {
    expect(canAskAgain(refused("expired"))).toBe(true);
    expect(canAskAgain(refused("burned"))).toBe(true);
    expect(canAskAgain(refused("wrong_code"))).toBe(false);
    expect(canAskAgain(null)).toBe(false);
  });
});

test.describe("запит", () => {
  test("🔴 несе Bearer — на відміну від решти форм акаунта", async () => {
    const { calls, fetchImpl } = spy(202, {
      sentTo: "i***@c***.de",
      expiresAt: "2026-11-04T18:00:00.000Z",
    });
    const out = await startClaim("alpenblick", BASE, fetchImpl, storageWith("TK"));
    expect(out).toEqual({
      kind: "sent",
      sentTo: "i***@c***.de",
      expiresAt: "2026-11-04T18:00:00.000Z",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/spot-claims`);
    expect(
      (calls[0].init.headers as Record<string, string>).authorization,
    ).toBe("Bearer TK");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ slug: "alpenblick" });
  });

  test("🔴 без сесії запиту НЕ ВІДБУВАЄТЬСЯ", async () => {
    // Нуль викликів — це критерій: інакше кожне відкриття сторінки
    // анонімом коштувало б нам 401 і виглядало б у логах як спроба.
    const { calls, fetchImpl } = spy(202, {});
    const out = await startClaim("x", BASE, fetchImpl, storageWith(null));
    expect(out).toEqual({ kind: "signed-out" });
    expect(calls).toHaveLength(0);
  });

  test("код іде зведеним, а не як набрано", async () => {
    const { calls, fetchImpl } = spy(200, { confirmed: true });
    const out = await confirmClaim("x", " ab-cd 2345 ", BASE, fetchImpl, storageWith("TK"));
    expect(out).toEqual({ kind: "confirmed" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      slug: "x",
      code: "ABCD2345",
    });
  });

  test("401 — це «увійди», а не «не вийшло»", async () => {
    const { fetchImpl } = spy(401, { code: "no_session" });
    expect(await confirmClaim("x", "ABCD2345", BASE, fetchImpl, storageWith("TK"))).toEqual({
      kind: "signed-out",
    });
  });

  test("текст сервера переважає, а без нього є запасний", async () => {
    const own = spy(409, { code: "already_claimed", message: "Taken already." });
    expect(
      await startClaim("x", BASE, own.fetchImpl, storageWith("TK")),
    ).toEqual({ kind: "refused", code: "already_claimed", message: "Taken already." });

    const mute = spy(409, { code: "already_claimed" });
    expect(
      await startClaim("x", BASE, mute.fetchImpl, storageWith("TK")),
    ).toEqual({
      kind: "refused",
      code: "already_claimed",
      message: REFUSAL_TEXT.already_claimed,
    });
  });

  test("🔴 порожня адреса API — і знову жодного виклику", async () => {
    const { calls, fetchImpl } = spy(202, {});
    expect(await startClaim("x", "", fetchImpl, storageWith("TK"))).toEqual({
      kind: "unavailable",
    });
    expect(calls).toHaveLength(0);
  });

  test("код без тексту й без переліку не лишає порожнього екрана", () => {
    expect(
      messageFor({ kind: "refused", code: "something_new", message: "" }),
    ).not.toBe("");
  });
});

test.describe("розмітка", () => {
  test("перший крок каже, куди піде лист, ДО натискання", () => {
    const html = renderClient(AskView, {
      spot: "alpenblick",
      busy: false,
      ready: true,
      onSend: () => {},
      message: null,
    });
    expect(html).toContain("OpenStreetMap");
    expect(html).toContain("alpenblick");
    expect(html).toContain("Send the code");
  });

  test("🔴 другий крок показує МАСКУ і ніде не показує адреси", () => {
    const html = renderClient(CodeView, {
      spot: "alpenblick",
      sentTo: "i***@c***.de",
      code: "",
      busy: false,
      ready: true,
      canSend: false,
      onCode: () => {},
      onConfirm: () => {},
      onSend: () => {},
      message: null,
    });
    expect(html).toContain("i***@c***.de");
    expect(html).not.toContain("@camping");
    // Поле коду приймає підказку з SMS/пошти — інакше людина переписує
    // вісім символів руками з іншого застосунку.
    expect(html).toContain('autoComplete="one-time-code"');
  });

  test("🔴 до гідратації поле вимкнене — як на /plan", () => {
    const html = renderClient(CodeView, {
      spot: "s",
      sentTo: "i***@c***.de",
      code: "",
      busy: false,
      ready: false,
      canSend: true,
      onCode: () => {},
      onConfirm: () => {},
      onSend: () => {},
      message: null,
    });
    expect(html).toContain("disabled");
  });

  test("🔴 готово не обіцяє кабінету, якого немає", () => {
    const html = renderClient(DoneView, { spot: "alpenblick" });
    expect(html).toContain("nothing on the page has changed yet");
  });
});
