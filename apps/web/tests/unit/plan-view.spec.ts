import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import PlanPage, { metadata } from "@/app/plan/page";
import { PlanFormView, PlanOutcomePanel } from "@/components/plan-view";
import { SiteHeader } from "@/components/site-chrome";
import { VEHICLES } from "@/lib/fuel";
import {
  EMPTY_DRAFT,
  FIELD_ORDER,
  MAX_DAYS,
  type PlanDraft,
  type PlanErrors,
  type PlanRequest,
  type PlanRun,
} from "@/lib/plan";
import { STATIC_HUBS } from "@/lib/sitemap";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";

// CAMP-205 — /plan, прочитана на ВИДАНОМУ HTML.
//
// 🔴 Кожне твердження нижче — про те, що є в розмітці, яку отримає
// читач, а не про константу, клас чи `data-testid`. `visibleText`
// викидає все приховане (`hidden`, `sr-only`, `display:none`), тож
// речення, яке лишилось би тільки в прихованому елементі, тут не
// рахується сказаним.
//
// Інтерактив (фокус, клік, Enter) — у tests/e2e/plan.spec.ts: розмітка
// без браузера його не показує, і цей файл його не вдає.

// ── Читання HTML ──────────────────────────────────────────────────────

const GOOD: PlanDraft = {
  from: "Ljubljana",
  to: "Split",
  days: "7",
  vehicleId: "motorhome",
};
const REQUEST: PlanRequest = {
  from: "Ljubljana",
  to: "Split",
  days: 7,
  vehicleId: "motorhome",
};
const ALL_BAD: PlanErrors = {
  from: "Enter where the trip starts.",
  to: "Enter where the trip ends.",
  days: "Enter how many days the trip lasts.",
  vehicleId: "Choose your vehicle.",
};

const noop = () => {};
const form = (
  over: { draft?: PlanDraft; errors?: PlanErrors; ready?: boolean } = {},
) =>
  renderComponent(PlanFormView, {
    draft: over.draft ?? EMPTY_DRAFT,
    errors: over.errors ?? {},
    ready: over.ready ?? true,
    onEdit: noop,
    onSubmit: noop,
    onJump: noop,
  });
const panel = (run: PlanRun) => renderComponent(PlanOutcomePanel, { run });

type Attrs = Record<string, string>;

/** Атрибути одного тега. Булеві (`disabled=""`) теж потрапляють — зі значенням `""`. */
function attrsOf(tag: string): Attrs {
  const out: Attrs = {};
  for (const m of tag.matchAll(/\s([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g))
    out[m[1]] = m[2] ?? "";
  return out;
}

const controls = (html: string) =>
  [...html.matchAll(/<(input|select|button)\b([^>]*)>/g)].map((m) => ({
    tag: m[1],
    attrs: attrsOf(m[2]),
  }));

const ids = (html: string) =>
  new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

/** Текст елемента за його `id`, прочитаний так, як його читає людина. */
function textOfId(html: string, id: string): string | null {
  const open = new RegExp(`<([a-z0-9]+)\\b[^>]*\\sid="${id}"[^>]*>`).exec(html);
  if (!open) return null;
  const name = open[1];
  const rest = html.slice(open.index + open[0].length);
  // Перший закривальний тег того ж імені: достатньо для p/h2/div без
  // вкладених однойменних, які тут єдині в користуванні.
  const close = rest.indexOf(`</${name}>`);
  return visibleText(rest.slice(0, close < 0 ? undefined : close));
}

const fieldControls = (html: string) =>
  controls(html).filter((c) => c.tag === "input" || c.tag === "select");

// ── Форма ─────────────────────────────────────────────────────────────

test.describe("форма", () => {
  test("🔴 у кожного поля є підпис, що на нього вказує, і він не порожній", () => {
    const html = form();
    const fields = fieldControls(html);
    expect(fields.map((f) => f.attrs.id).sort()).toEqual(
      ["plan-days", "plan-from", "plan-to", "plan-vehicle"].sort(),
    );
    for (const f of fields) {
      const label = new RegExp(
        `<label\\b[^>]*\\sfor="${f.attrs.id}"[^>]*>([\\s\\S]*?)</label>`,
      ).exec(html);
      expect(label, `поле ${f.attrs.id} без <label for>`).not.toBeNull();
      expect(
        visibleText(label![1]).length,
        `підпис поля ${f.attrs.id} порожній`,
      ).toBeGreaterThan(2);
    }
  });

  test("🔴 усі чотири поля обовʼязкові для читача екрана, і форма не покладається на браузерні бульбашки", () => {
    const html = form();
    for (const f of fieldControls(html))
      expect(f.attrs, f.attrs.id).toHaveProperty("required");
    // React віддає `noValidate` у статичній розмітці як є; HTML до
    // регістру імені атрибута байдужий, тож порівняння — без нього.
    expect(
      /<form\b[^>]*\snovalidate=""/i.test(html),
      "форма без noValidate",
    ).toBe(true);
  });

  test("транспорт: у списку рівно ті профілі, що й у калькуляторі, плюс порожній вибір", () => {
    const html = form();
    const select = /<select\b[\s\S]*?<\/select>/.exec(html)![0];
    const options = [
      ...select.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g),
    ].map((m) => [attrsOf(m[1]).value, m[2]]);
    expect(options).toEqual([
      ["", "Choose your vehicle"],
      ...VEHICLES.map((v) => [v.id, v.label]),
    ]);
  });

  test("🔴 до гідратації все вимкнено і сказано чому; після — нічого не вимкнено", () => {
    const before = form({ ready: false });
    for (const c of controls(before))
      expect(c.attrs, `${c.tag} ${c.attrs.id ?? ""}`).toHaveProperty(
        "disabled",
      );
    expect(visibleText(before)).toContain(
      "The form comes alive when the page finishes loading",
    );

    const after = form({ ready: true });
    for (const c of controls(after))
      expect(c.attrs, `${c.tag} ${c.attrs.id ?? ""}`).not.toHaveProperty(
        "disabled",
      );
    expect(visibleText(after)).not.toContain("comes alive");
  });

  test("порожня форма без помилок не малює ні підсумку, ні рядків помилок", () => {
    const html = form();
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("There is a problem");
    expect(visibleText(html)).not.toContain("Error:");
    for (const f of fieldControls(html))
      expect(f.attrs, f.attrs.id).not.toHaveProperty("aria-invalid");
  });

  test("🔴 підсумок помилок: кожна рівно раз, в порядку полів, кожне посилання веде на поле", () => {
    const html = form({ errors: ALL_BAD });
    expect(html).toContain('role="alert"');
    const summary = /<div\b[^>]*role="alert"[\s\S]*?<\/ul>/.exec(html)![0];
    const links = [...summary.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(
      (m) => ({
        href: attrsOf(m[1]).href,
        text: visibleText(m[2]),
      }),
    );

    // Порядок на екрані, а не порядок перевірки в коді.
    expect(links.map((l) => l.text)).toEqual(
      FIELD_ORDER.map((f) => ALL_BAD[f]),
    );

    // Кожне посилання веде на існуючий елемент, і це поле форми.
    const fieldIds = new Set(fieldControls(html).map((f) => f.attrs.id));
    for (const l of links) {
      expect(l.href.startsWith("#"), l.href).toBe(true);
      expect(fieldIds.has(l.href.slice(1)), `${l.href} не веде на поле`).toBe(
        true,
      );
    }
    expect(new Set(links.map((l) => l.href)).size).toBe(4);
  });

  test("🔴 хибне поле помічене, а повідомлення до нього прикріплене й видиме", () => {
    const html = form({ errors: ALL_BAD });
    const present = ids(html);
    for (const f of fieldControls(html)) {
      expect(f.attrs["aria-invalid"], f.attrs.id).toBe("true");
      const described = (f.attrs["aria-describedby"] ?? "")
        .split(/\s+/)
        .filter(Boolean);
      expect(described.length, `${f.attrs.id} без опису`).toBeGreaterThan(0);
      for (const d of described)
        expect(present.has(d), `${f.attrs.id} → #${d} немає в документі`).toBe(
          true,
        );
      // Серед описів — саме повідомлення про помилку цього поля, словами.
      const key = FIELD_ORDER.find(
        (k) => `plan-${k === "vehicleId" ? "vehicle" : k}` === f.attrs.id,
      )!;
      const spoken = described.map((d) => textOfId(html, d)).join(" | ");
      expect(spoken, `${f.attrs.id}: помилку не озвучено`).toContain(
        ALL_BAD[key],
      );
      expect(spoken).toContain("Error:");
    }
  });

  test("🔴 правильні поля не помічені хибними, хоч поруч є хибне", () => {
    const html = form({
      draft: { ...GOOD, days: "" },
      errors: { days: ALL_BAD.days },
    });
    for (const f of fieldControls(html)) {
      if (f.attrs.id === "plan-days") {
        expect(f.attrs["aria-invalid"]).toBe("true");
      } else {
        expect(f.attrs, f.attrs.id).not.toHaveProperty("aria-invalid");
        expect(f.attrs["aria-describedby"] ?? "", f.attrs.id).not.toContain(
          "-error",
        );
      }
    }
    // Підсумок говорить лише про одне.
    const summary = /<div\b[^>]*role="alert"[\s\S]*?<\/ul>/.exec(html)![0];
    expect([...summary.matchAll(/<a\b/g)]).toHaveLength(1);
  });

  test("🔴 жоден aria-describedby не вказує в порожнечу — у жодному стані", () => {
    const states = [
      form(),
      form({ errors: ALL_BAD }),
      form({ draft: GOOD }),
      form({ draft: GOOD, errors: { from: ALL_BAD.from } }),
      form({ draft: { ...GOOD, vehicleId: "campervan" } }),
    ];
    for (const html of states) {
      const present = ids(html);
      for (const c of controls(html)) {
        for (const d of (c.attrs["aria-describedby"] ?? "")
          .split(/\s+/)
          .filter(Boolean)) {
          expect(present.has(d), `#${d} немає`).toBe(true);
        }
      }
    }
  });

  test("значення, яке ввели, повертається в поле", () => {
    const html = form({ draft: GOOD });
    const byId = Object.fromEntries(
      fieldControls(html).map((f) => [f.attrs.id, f.attrs]),
    );
    expect(byId["plan-from"].value).toBe("Ljubljana");
    expect(byId["plan-to"].value).toBe("Split");
    expect(byId["plan-days"].value).toBe("7");
    // Обране — це `selected` на варіанті, а не атрибут select.
    expect(
      /<option\b[^>]*\svalue="motorhome"[^>]*\sselected=""/.test(html),
    ).toBe(true);
  });

  test("підказка про дні називає ту межу, яку справді перевіряє код", () => {
    expect(visibleText(form())).toContain(`Whole days, 1 to ${MAX_DAYS}.`);
  });

  test("профіль транспорту: після вибору показується його примітка, до вибору — ні", () => {
    const chosen = VEHICLES.find((v) => v.id === "motorhome")!;
    expect(visibleText(form({ draft: GOOD }))).toContain(chosen.note);
    expect(visibleText(form())).not.toContain(chosen.note);
  });
});

// ── Панель відповіді ──────────────────────────────────────────────────

test.describe("панель відповіді", () => {
  const done = (
    outcome: { status: "unavailable" } | { status: "failed" },
    request = REQUEST,
  ): PlanRun => ({
    phase: "done",
    id: 1,
    request,
    outcome,
  });

  test("🔴 до першої відповіді: порожня, чесна і з ділянкою оголошень, що вже існує", () => {
    const html = panel({ phase: "idle" });
    const said = visibleText(html);
    expect(said).toContain("Your route");
    expect(said).toContain("Nothing asked yet");
    // Жодного вигаданого змісту: ні запиту, ні маршруту.
    expect(said).not.toContain("What you asked for");
    expect(said).not.toMatch(/\bkm\b/);
    // Область оголошень мусить бути в документі ДО відповіді, інакше
    // екранний читач змовчить, коли вона зʼявиться.
    expect(html).toContain('aria-live="polite"');
  });

  test("🔴 «не рахує» — прямим реченням, і запит повторено словами, а не ідентифікаторами", () => {
    const said = visibleText(panel(done({ status: "unavailable" })));
    expect(said).toContain("No route to show.");
    expect(said).toContain("The planner does not calculate routes yet");
    expect(said).toContain("What you asked for");
    for (const part of ["Ljubljana", "Split", "7", "Motorhome (6–7.5 m)"]) {
      expect(said, part).toContain(part);
    }
    // `motorhome` — ідентифікатор, а не те, що читач вибирав.
    expect(said).not.toContain("motorhome");
  });

  test("🔴 «не збережено й нікуди не надіслано» — лише там, де це відомо, тобто в unavailable", () => {
    expect(visibleText(panel(done({ status: "unavailable" })))).toContain(
      "They were not saved, and they were not sent anywhere.",
    );
    // Коли джерело ВПАЛО, ми не знаємо, чи воно щось надсилало, і не кажемо.
    const failed = visibleText(panel(done({ status: "failed" })));
    expect(failed).not.toContain("not sent");
    expect(failed).not.toContain("not saved");
  });

  test("🔴 збій: каже про збій, лишає людині її відповіді й не вдає результату", () => {
    const said = visibleText(panel(done({ status: "failed" })));
    expect(said).toContain("The planner did not answer.");
    expect(said).toContain("still in the form");
    expect(said).not.toContain("No route to show");
    expect(said).not.toContain("What you asked for");
  });

  test("очікування: одне речення, без вигаданого прогресу", () => {
    const said = visibleText(
      panel({ phase: "pending", id: 1, request: REQUEST }),
    );
    expect(said).toContain("Asking the planner");
    expect(said).not.toMatch(/\d+\s*%/);
    expect(said).not.toContain("What you asked for");
  });

  test("🔴 назва місця з розміткою виводиться текстом, а не розміткою", () => {
    const html = panel(
      done(
        { status: "unavailable" },
        { ...REQUEST, from: "<img src=x onerror=alert(1)>" },
      ),
    );
    expect(html).not.toContain("<img");
    expect(visibleText(html)).toContain("<img src=x onerror=alert(1)>");
  });

  test("не малює нічого, що схоже на маршрут: ні мапи, ні списку зупинок", () => {
    for (const run of [
      panel({ phase: "idle" }),
      panel(done({ status: "unavailable" })),
      panel(done({ status: "failed" })),
    ]) {
      expect(run).not.toMatch(/<canvas|<svg|<ol\b|<table/);
    }
  });
});

// ── Сторінка ──────────────────────────────────────────────────────────

test.describe("сторінка /plan", () => {
  const page = () => renderComponent(PlanPage, {});

  test("🔴 каже прямо, що не рахує, — у виданому HTML і ПЕРЕД формою", () => {
    const said = visibleText(page());
    const verdict = said.indexOf("This planner does not calculate routes yet.");
    const formStart = said.indexOf("Your trip");
    expect(
      verdict,
      "речення немає в видимому тексті сторінки",
    ).toBeGreaterThanOrEqual(0);
    expect(formStart).toBeGreaterThan(verdict);
  });

  test("🔴 каже, що саме зʼявиться, коли запрацює — за карткою: маршрут на мапі й список зупинок", () => {
    const said = visibleText(page());
    expect(said).toContain("route drawn on a map");
    expect(said).toContain("the stops along it");
  });

  test("🔴 єдина дія на сторінці — «Check my trip»; кабінету й конверсійних дій немає", () => {
    // Картка просить мапу й зупинки. «Зберегти в кабінет» і «поділитись»
    // — окремі дії, яким потрібен кабінет, якого немає. Перевіряється
    // властивість («які дії є»), а не список слів, які сторінка могла б
    // сказати: будь-яка нова кнопка чи посилання червонить цей тест,
    // хоч би яким словом її підписано.
    const html = page();
    const buttons = controls(html).filter((c) => c.tag === "button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].attrs.type).toBe("submit");
    expect(visibleText(/<button\b[\s\S]*?<\/button>/.exec(html)![0])).toBe(
      "Check my trip",
    );

    expect([...html.matchAll(/<form\b/g)]).toHaveLength(1);
    const hrefs = [...html.matchAll(/<a\b([^>]*)>/g)]
      .map((m) => attrsOf(m[1]).href)
      .sort();
    expect(hrefs).toEqual(["/map", "/routes", "/tools/camper-trip-cost"]);
  });

  test("«що працює сьогодні» веде в три справжні місця, а не в порожнечу", () => {
    const html = page();
    const app = path.join(__dirname, "..", "..", "src", "app");
    for (const href of ["/routes", "/map", "/tools/camper-trip-cost"]) {
      expect(html, href).toContain(`href="${href}"`);
      expect(
        existsSync(path.join(app, href, "page.tsx")),
        `${href}: немає сторінки`,
      ).toBe(true);
    }
  });

  test("є хлібні крихти, що ведуть на себе", () => {
    const html = page();
    expect(html).toContain("BreadcrumbList");
    expect(html).toContain("/plan");
  });

  test("🔴 рішення про індексацію: noindex, follow — і сторінки немає в карті сайту", () => {
    // `/search` — той самий прецедент. Коли планувальник справді
    // рахуватиме, цей тест червоніє навмисно: три речі міняються разом
    // (див. коментар у app/plan/page.tsx).
    expect(metadata.robots).toEqual({ index: false, follow: true });
    const paths = STATIC_HUBS.map((u) => new URL(u.loc).pathname);
    expect(paths).not.toContain("/plan");
  });

  test("метадані: заголовок, опис без обіцянок, канонічна адреса", () => {
    expect(metadata.title).toBe("Trip planner");
    expect(String(metadata.description)).toContain(
      "does not calculate routes yet",
    );
    expect(metadata.alternates?.canonical).toBe("/plan");
  });
});

// ── Вхід ──────────────────────────────────────────────────────────────

// 🔴 CAMP-365 РОЗДІЛИВ ЦЕЙ ТЕСТ НАДВОЄ, І ЦЕ НЕ ПОСЛАБЛЕННЯ.
//
// Доти він малював шапку й шукав у ній `/plan`, бо перелік пунктів жив
// масивом у `site-chrome.tsx`. Тепер меню приходить із бази, і та сама
// перевірка над шапкою стверджувала б лише те, що тест сам же їй і
// передав, — тобто доводила б себе собою.
//
// Тому твердження стоять там, де тепер лежить кожна з двох половин:
//   • «пункт існує і веде на /plan» — у сиді, бо сид і є джерелом;
//   • «шапка малює те, що їй дали» — на рендері, з фікстурою;
//   • «/plan справді відкривається» — у `tests/e2e/navigation.spec.ts`,
//     який бере КОЖЕН пункт із бази й питає сторінку по HTTP. Це
//     сильніше за перевірку наявності файла, яка тут була.
test("🔴 меню пропонує «Plan a trip», і сторінка під нього існує", () => {
  const seed = readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "api",
      "src",
      "migrations",
      "1792300000000-SeedNavigation.ts",
    ),
    "utf8",
  );
  expect(seed, "сид не кладе пункт «Plan a trip» → /plan").toContain(
    "['/plan', 'Plan a trip']",
  );
  expect(
    existsSync(
      path.join(__dirname, "..", "..", "src", "app", "plan", "page.tsx"),
    ),
  ).toBe(true);
});

test("🔴 шапка малює КОЖЕН пункт, який їй дали, посиланням", () => {
  const nav = [
    { href: "/plan", label: "Plan a trip", children: [] },
    { href: "/guides", label: "Guides", children: [] },
  ];
  const html = renderComponent(SiteHeader, { nav });

  for (const item of nav) {
    const link = new RegExp(
      `<a\\b[^>]*\\shref="${item.href}"[^>]*>([\\s\\S]*?)</a>`,
    ).exec(html);
    expect(link, `шапка не намалювала пункт ${item.href}`).not.toBeNull();
    expect(visibleText(link![1])).toBe(item.label);
  }

  // 🔴 ПАРА ДО ЦИКЛУ. «Кожен пункт намальовано» істинне й над порожнім
  // переліком — а шапка, що малює порожнечу, це саме той збій, якого
  // переїзд у базу й додав як можливість.
  expect(
    nav.length,
    "фікстура порожня — цикл вище нічого не перевірив",
  ).toBeGreaterThan(1);
});
