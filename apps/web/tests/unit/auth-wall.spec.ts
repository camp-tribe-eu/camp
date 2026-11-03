import { expect, test } from "@playwright/test";

import { needsLogin, pauseForLogin } from "@/lib/auth-wall";
import { isReturnPath } from "@/lib/return-path";

// CAMP-227 — стіна входу як пауза, і чому `?next=` тут немає.

test.describe("пауза посеред дії", () => {
  test("памʼятає, де людина стоїть, і веде на /login", () => {
    const seen: unknown[] = [];
    const went: string[] = [];
    pauseForLogin(
      { pathname: "/account/claim", search: "?spot=alpenblick" },
      (to) => went.push(to),
      (p) => (seen.push(p), true),
    );
    expect(seen).toEqual(["/account/claim?spot=alpenblick"]);
    expect(went).toEqual(["/login"]);
  });

  test("🔴 записує ДО переходу, а не після", () => {
    // Інакше навігація знімає сторінку раніше, ніж намір ляже в
    // сховище, і людина повертається на типове місце — мовчки й лише
    // іноді, тобто найгіршим можливим способом.
    const order: string[] = [];
    pauseForLogin(
      { pathname: "/account/listings", search: "" },
      () => order.push("go"),
      () => (order.push("remember"), true),
    );
    expect(order).toEqual(["remember", "go"]);
  });

  test("порожній запит не додає зайвого знака", () => {
    const seen: unknown[] = [];
    pauseForLogin({ pathname: "/account", search: "" }, () => {}, (p) => (seen.push(p), true));
    expect(seen).toEqual(["/account"]);
  });
});

test.describe("🔴 open redirect: чому ?next= тут немає", () => {
  test("чужий домен не є місцем повернення", () => {
    // Це той самий сторож, через який заведена CAMP-227. Перевірка
    // живе в `isReturnPath`, а тут доводиться, що вона справді не
    // пропускає того, чим лякає картка.
    for (const evil of [
      "https://evil.example",
      "//evil.example",
      "http://evil.example/x",
      "/\\evil.example",
      "javascript:alert(1)",
      "/account?x=%2F%2Fevil.example",
    ]) {
      expect(isReturnPath(evil), evil).toBe(false);
    }
  });

  test("а свій шлях — є", () => {
    for (const ok of ["/", "/account", "/account/claim?spot=x", "/camping/de/bayern/x"]) {
      expect(isReturnPath(ok), ok).toBe(true);
    }
  });

  test("🔴 і pauseForLogin фізично не може взяти чужу адресу", () => {
    // Вона складає шлях із того, де людина СТОЇТЬ, і більше нізвідки.
    //
    // 🔴 Спершу тут стояло `expect(pauseForLogin.length).toBe(3)` — я
    // вирішив, що арність доведе «параметра для адреси немає». Не
    // доводить нічого: `Function.length` рахує лише аргументи ДО
    // першого зі значенням за замовчуванням, тож їх 2, а не 3. І
    // навіть якби 3 — арність не каже, звідки береться значення.
    // Доводить ось що: чужа адреса, підсунута в запит, не проходить.
    const seen: unknown[] = [];
    pauseForLogin(
      { pathname: "/account", search: "?next=https://evil.example" },
      () => {},
      (p) => (seen.push(p), true),
    );
    // Запит потрапляє у рядок як є — і саме тому його відкидає
    // `isReturnPath`: `:` і `//` у формі не дозволені.
    expect(isReturnPath(seen[0])).toBe(false);
  });
});

test.describe("«не ввійшов» і «нічого немає» — різне", () => {
  test("signed-out просить вхід", () => {
    expect(needsLogin("signed-out")).toBe(true);
  });

  test("усе інше — ні", () => {
    for (const k of ["ok", "failed", "unavailable", "refused", "sent", "saved"]) {
      expect(needsLogin(k), k).toBe(false);
    }
  });
});
