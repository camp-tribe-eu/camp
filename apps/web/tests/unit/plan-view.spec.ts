import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import PlanPage, { metadata } from "@/app/plan/page";
import {
  distance,
  PlanFormView,
  PlanOutcomePanel,
  STRAIGHT_LINE,
} from "@/components/plan-view";
import { SiteHeader } from "@/components/site-chrome";
import { AMENITY_LABEL } from "@/lib/api";
import {
  checkDraft,
  EMPTY_DRAFT,
  EXAMPLE,
  fieldOrder,
  MAX_DAYS,
  MAX_VIA,
  type PlanDraft,
  type PlanErrors,
  type PlanOutcome,
  type PlanRun,
  type TripRequest,
} from "@/lib/plan";
import { readPlan } from "@/lib/plan-source";
import { STRAIGHT_LINE_LABEL } from "@/lib/routes";
import { STATIC_HUBS } from "@/lib/sitemap";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";

// CAMP-205 — /plan, прочитана на ВИДАНОМУ HTML.
// CAMP-391 — і її відповідь, намальована зі СПРАВЖНЬОЇ відповіді API.
//
// 🔴 Кожне твердження нижче — про те, що є в розмітці, яку отримає
// читач, а не про константу, клас чи `data-testid`. `visibleText`
// викидає все приховане (`hidden`, `sr-only`, `display:none`), тож
// речення, яке лишилось би тільки в прихованому елементі, тут не
// рахується сказаним.
//
// 🔴 План малюється з `tests/unit/fixtures/plan-ok.json` — відповіді, знятої з
// `POST /plan` над справжніми даними (див. plan-source.spec.ts), яку пропущено
// через `readPlan`, тобто тим самим читачем, що й у браузері. Панель, намальована
// з об'єкта, зібраного руками в тесті, показувала б, що вона вміє малювати
// мою уяву про відповідь.
//
// Інтерактив (фокус, клік, Enter) — у tests/e2e/plan.spec.ts: розмітка
// без браузера його не показує, і цей файл його не вдає.

// ── Читання HTML ──────────────────────────────────────────────────────

const GOOD: PlanDraft = {
  ...EMPTY_DRAFT,
  from: "46.0569, 14.5058",
  to: "43.5081, 16.4402",
  days: "7",
};

/** Поїздка, з якою зняті файли відповідей API: Ліон → Барселона на сім днів. */
const tripOf = (draft: Partial<PlanDraft>): TripRequest => {
  const r = checkDraft({ ...EMPTY_DRAFT, ...draft });
  if (!r.ok) throw new Error("fixture trip is invalid");
  return r.trip;
};
const REQUEST = tripOf({ from: "45.764, 4.8357", to: "41.3874, 2.1686", days: "7" });

// Тексти помилок виписані в plan.spec.ts; тут важить, ЩО ОЗВУЧЕНО ПОРУЧ ІЗ ПОЛЕМ, а не слова.
const ALL_BAD: PlanErrors = {
  from: "Enter where the trip starts: type a place name and pick it from the list, or write latitude and longitude, for example 46.0569, 14.5058.",
  to: "Enter where the trip ends: type a place name and pick it from the list, or write latitude and longitude, for example 46.0569, 14.5058.",
  days: "Enter how many days the trip lasts.",
};
const REQUIRED = ["from", "to", "days"] as const;

/** Відповідь API, знята з сервера, і те, що з неї виходить після `readPlan`. */
const captured = (name: string): { status: number; body: unknown } =>
  JSON.parse(
    readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"),
  );
const outcomeOf = (name: string): PlanOutcome => {
  const c = captured(name);
  return readPlan(c.status, c.body);
};
const PLAN = outcomeOf("plan-ok");

const noop = () => {};
const form = (
  over: { draft?: PlanDraft; errors?: PlanErrors; ready?: boolean; notice?: string | null } = {},
) =>
  renderComponent(PlanFormView, {
    draft: over.draft ?? EMPTY_DRAFT,
    errors: over.errors ?? {},
    ready: over.ready ?? true,
    notice: over.notice ?? null,
    onEdit: noop,
    onPick: noop,
    onVehicleType: noop,
    onRoundTrip: noop,
    onAddVia: noop,
    onRemoveVia: noop,
    onMoveVia: noop,
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

// Чекбокс підписаний обгорткою `<label>`, а не `for` (checkbox.tsx): його читає
// окремий тест; решту полів — цей перелік.
const fieldControls = (html: string) =>
  controls(html).filter(
    (c) => (c.tag === "input" || c.tag === "select") && c.attrs.type !== "checkbox",
  );

// ── Форма ─────────────────────────────────────────────────────────────

test.describe("форма", () => {
  test("🔴 у кожного поля є підпис, що на нього вказує, і він не порожній", () => {
    const html = form();
    const fields = fieldControls(html);
    expect(fields.map((f) => f.attrs.id).sort()).toEqual(
      [
        "plan-days",
        "plan-from",
        "plan-height",
        "plan-length",
        "plan-to",
        "plan-vehicle-type",
        "plan-weight",
      ].sort(),
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

  test("🔴 три поля обовʼязкові для читача екрана (габарити — ні), і форма не покладається на браузерні бульбашки", () => {
    const html = form();
    for (const f of fieldControls(html)) {
      const mustHave = ["plan-from", "plan-to", "plan-days"].includes(f.attrs.id);
      if (mustHave) expect(f.attrs, f.attrs.id).toHaveProperty("required");
      else expect(f.attrs, f.attrs.id).not.toHaveProperty("required");
    }
    // React віддає `noValidate` у статичній розмітці як є; HTML до
    // регістру імені атрибута байдужий, тож порівняння — без нього.
    expect(
      /<form\b[^>]*\snovalidate=""/i.test(html),
      "форма без noValidate",
    ).toBe(true);
  });

  test("🔴 габарити в формі є, і ТУТ ЖЕ сказано, що план від них не залежить: поле, що нічого не міняє, не обіцяє план «під ваш кемпер»", () => {
    const html = form();
    const hint = textOfId(html, "plan-vehicle-hint")!;
    expect(hint).toContain("Saved with your trip and kept in the link, but the planner does not use them yet");
    expect(hint).toContain("the plan is the same whatever you enter here");
    // Підказка прикріплена до кожного з трьох полів, а не стоїть осторонь.
    for (const id of ["plan-height", "plan-length", "plan-weight"]) {
      const f = fieldControls(html).find((c) => c.attrs.id === id)!;
      expect(f.attrs["aria-describedby"], id).toContain("plan-vehicle-hint");
    }
    // Ні слова про те, що план «підбирається під» транспорт.
    expect(visibleText(html)).not.toMatch(/fits your (vehicle|camper)|suitable for your|will not fit/i);
  });

  test("🔴 селект: власний шеврон у розмітці, а типів транспорту — рівно чотири і «не вказано»", () => {
    const html = form();
    const select = controls(html).filter((c) => c.tag === "select");
    expect(select).toHaveLength(1);
    expect(select[0].attrs.id).toBe("plan-vehicle-type");
    // Шеврон — вбудований SVG поряд із селектом (computed-style 40px — у e2e).
    expect(html).toMatch(/<select\b[\s\S]*?<\/select>\s*<svg\b[^>]*data-testid="select-chevron"/);
    const options = [...html.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/g)].map((m) => visibleText(m[1]));
    expect(options).toEqual(["Not specified", "Motorhome", "Campervan", "Car with a caravan", "Car with a tent"]);
  });

  test("🔴 проміжні точки: кожна — рядок із полем, «вгору/вниз/прибрати», і кнопки називають її номер", () => {
    const draft: PlanDraft = {
      ...GOOD,
      via: [
        { id: "7", text: "Bled", place: null },
        { id: "9", text: "", place: null },
      ],
    };
    const html = form({ draft });
    expect([...html.matchAll(/data-testid="via-row"/g)]).toHaveLength(2);
    const labels = fieldControls(html).map((f) => f.attrs.id);
    expect(labels).toContain("plan-via-7");
    expect(labels).toContain("plan-via-9");
    const said = visibleText(html);
    expect(said).toContain("Stop 1");
    expect(said).toContain("Stop 2");
    const names = controls(html)
      .filter((c) => c.tag === "button")
      .map((c) => c.attrs["aria-label"])
      .filter(Boolean);
    expect(names).toEqual([
      "Move stop 1 up",
      "Move stop 1 down",
      "Remove stop 1",
      "Move stop 2 up",
      "Move stop 2 down",
      "Remove stop 2",
    ]);
    // Крайні кнопки вимкнено: першу нікуди «вгору», останню нікуди «вниз».
    const byName = Object.fromEntries(
      controls(html)
        .filter((c) => c.attrs["aria-label"])
        .map((c) => [c.attrs["aria-label"], c.attrs]),
    );
    expect(byName["Move stop 1 up"]).toHaveProperty("disabled");
    expect(byName["Move stop 2 down"]).toHaveProperty("disabled");
    expect(byName["Move stop 1 down"]).not.toHaveProperty("disabled");
    // Значення проміжної точки повертається в її поле.
    expect(fieldControls(html).find((f) => f.attrs.id === "plan-via-7")!.attrs.value).toBe("Bled");
    // Без проміжних точок списку немає взагалі.
    expect(form()).not.toContain('data-testid="via-list"');
  });

  test("🔴 «додати зупинку» вимикається на межі, і сказано чому", () => {
    const many = Array.from({ length: MAX_VIA }, (_, i) => ({ id: String(i + 1), text: "", place: null }));
    const full = form({ draft: { ...GOOD, via: many } });
    const add = controls(full).find((c) => c.attrs["data-testid"] === "add-via")!;
    expect(add.attrs).toHaveProperty("disabled");
    expect(visibleText(full)).toContain(`up to ${MAX_VIA} stops between the start and the destination`);
    const room = controls(form({ draft: { ...GOOD, via: many.slice(1) } })).find(
      (c) => c.attrs["data-testid"] === "add-via",
    )!;
    expect(room.attrs).not.toHaveProperty("disabled");
  });

  test("🔴 «Return to the start» — справжній чекбокс зі станом із чернетки", () => {
    const off = form({ draft: GOOD });
    const on = form({ draft: { ...GOOD, roundTrip: true } });
    const box = (html: string) => /<input\b[^>]*type="checkbox"[^>]*>/.exec(html)![0];
    expect(attrsOf(box(off))).not.toHaveProperty("checked");
    expect(attrsOf(box(on))).toHaveProperty("checked");
    expect(visibleText(off)).toContain("Return to the start");
  });

  test("повідомлення про `?to=` чи посилання — над формою, і лише коли воно є", () => {
    expect(form()).not.toContain("plan-notice");
    const html = form({ notice: "Destination set to Camping Bled." });
    expect(visibleText(html)).toContain("Destination set to Camping Bled.");
    expect(html).toContain('role="status"');
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
      REQUIRED.map((f) => ALL_BAD[f]),
    );

    // Кожне посилання веде на існуючий елемент, і це поле форми.
    const fieldIds = new Set(fieldControls(html).map((f) => f.attrs.id));
    for (const l of links) {
      expect(l.href.startsWith("#"), l.href).toBe(true);
      expect(fieldIds.has(l.href.slice(1)), `${l.href} не веде на поле`).toBe(
        true,
      );
    }
    expect(new Set(links.map((l) => l.href)).size).toBe(3);
  });

  test("🔴 хибне поле помічене, а повідомлення до нього прикріплене й видиме", () => {
    const html = form({ errors: ALL_BAD });
    const present = ids(html);
    for (const f of fieldControls(html).filter((c) => ["plan-from", "plan-to", "plan-days"].includes(c.attrs.id))) {
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
      const key = fieldOrder(EMPTY_DRAFT).find((k) => `plan-${k}` === f.attrs.id)! as (typeof REQUIRED)[number];
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
    expect(byId["plan-from"].value).toBe("46.0569, 14.5058");
    expect(byId["plan-to"].value).toBe("43.5081, 16.4402");
    expect(byId["plan-days"].value).toBe("7");
  });

  test("🔴 підказка до полів місць: пошук за назвою — лише з нашої бази й у місцевому написанні; координати теж годяться; приклад справжній", () => {
    const html = form();
    const hint = textOfId(html, "plan-places-hint")!;
    expect(hint).toBe(
      `Type at least three letters of a city, town, village, region or campsite and pick it from the list. Names are matched as they are written locally (München, not Munich). Or write latitude, then longitude, in degrees: Ljubljana is ${EXAMPLE.from}.`,
    );
    // Підказка прикріплена до обох полів і не обіцяє того, чого пошук не вміє.
    for (const id of ["plan-from", "plan-to"]) {
      const f = fieldControls(html).find((c) => c.attrs.id === id)!;
      expect(f.attrs["aria-describedby"]).toContain("plan-places-hint");
      expect(f.attrs.role, id).toBe("combobox");
    }
    const said = visibleText(html);
    expect(said).not.toContain("will not work");
    expect(said).not.toContain("not looked up yet");
    expect(said).not.toMatch(/anywhere in the world|street address/i);
    expect(said).toContain("Starting point");
    expect(said).toContain("Destination");
  });

  test("підказка про дні називає ту межу, яку справді перевіряє код", () => {
    expect(visibleText(form())).toContain(
      `Whole days, 1 to ${MAX_DAYS}, and at least one per leg of the trip.`,
    );
  });
});

// ── Панель відповіді ──────────────────────────────────────────────────

test.describe("панель відповіді", () => {
  const done = (outcome: PlanOutcome, request = REQUEST): PlanRun => ({
    phase: "done",
    id: 1,
    request,
    legs: request.legs.map((leg) => ({ leg, outcome })),
  });
  const planHtml = () => panel(done(PLAN));
  const nightsOf = () => {
    if (PLAN.status !== "planned") throw new Error("fixture is not a plan");
    return PLAN.plan.days.flatMap((d) => (d.night ? [d.night] : []));
  };

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

  test("очікування: одне речення, без вигаданого прогресу", () => {
    const said = visibleText(
      panel({ phase: "pending", id: 1, request: REQUEST }),
    );
    expect(said).toContain("Asking the planner");
    expect(said).not.toMatch(/\d+\s*%/);
    expect(said).not.toContain("What you asked for");
  });

  // ── план ──

  test("🔴 план: сім днів, шість ночівель — словами, з номерами днів у порядку", () => {
    const said = visibleText(planHtml());
    expect(said).toContain("7 days, 6 nights.");
    const days = [...said.matchAll(/Day (\d)\b/g)].map((m) => Number(m[1]));
    expect(days).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Останній день закінчується в точці Б, а не ночівлею.
    expect(said).toMatch(/Day 7[^]*to your destination\./);
    expect(said.match(/A night at/g)).toHaveLength(6);
  });

  test("🔴 КОЖНА відстань названа прямою — і сказано ПЕРШИМ, що це не дорога", () => {
    const said = visibleText(planHtml());
    // Речення стоїть до списку днів, не під ним.
    const warning = said.indexOf("Every distance here is a straight line, not a road.");
    expect(warning, "речення про пряму немає").toBeGreaterThanOrEqual(0);
    expect(warning).toBeLessThan(said.indexOf("Day 1"));
    expect(said).toContain("cannot say how far a day’s drive is or how long it takes");
    // І властивість, а не список слів: кожне число з одиницею довжини в
    // плані — поруч зі словами «in a straight line» чи в реченні, що
    // описує відстань від точки до лінії.
    const bare = [...said.matchAll(/(\d[\d,.]*) km\b(?! in a straight line)/g)];
    for (const m of bare) {
      const around = said.slice(Math.max(0, m.index! - 80), m.index! + 80);
      expect(around, `«${m[0]}» без «прямою» поруч`).toMatch(
        /straight line|from that point|to the side/,
      );
    }
  });

  test("🔴 жодного слова про дорогу чи час за кермом, у жодному стані панелі", () => {
    const states: PlanOutcome[] = [
      PLAN,
      outcomeOf("plan-no-chain"),
      outcomeOf("plan-round-trip"),
      outcomeOf("plan-outside-union"),
      outcomeOf("plan-throttled"),
      { status: "failed" },
    ];
    for (const o of states) {
      const said = visibleText(panel(done(o)));
      // «not a road» і «cannot say … how long it takes» — самі й є застереженням.
      const stripped = said
        .replace("Every distance here is a straight line, not a road.", "")
        .replace(
          "The planner does not know the roads, so it cannot say how far a day’s drive is or how long it takes.",
          "",
        );
      expect(stripped, o.status).not.toMatch(
        // «in a minute» у відмові ліміту — про вікно ліміту, а не про дорогу;
        // про дорогу — число з хвилинами чи годинами, або слова про шосе.
        /\b(hours?|\d+\s*(minutes?|mins?)|drive time|driving time|travel time|ETA|motorway|highway|route planner|fastest|quickest|by road)\b/i,
      );
    }
  });

  test("🔴 ночівля: назва — посиланням на сторінку кемпінгу, країна словами, а не кодом", () => {
    const html = planHtml();
    for (const n of nightsOf()) {
      const link = new RegExp(
        `<a\\b[^>]*\\shref="${n.path}"[^>]*>([\\s\\S]*?)</a>`,
      ).exec(html);
      expect(link, `${n.slug}: немає посилання`).not.toBeNull();
      expect(visibleText(link![1])).toBe(n.name);
    }
    const said = visibleText(html);
    expect(said).toContain("(France)");
    expect(said).toContain("(Spain)");
    expect(said).not.toMatch(/\((FR|ES)\)/);
  });

  test("🔴 назва кемпінгу виводиться текстом, а не розміткою: вона з OSM, тобто чужа", () => {
    const evil = JSON.parse(JSON.stringify(captured("plan-ok").body));
    evil.days[0].night.name = "<img src=x onerror=alert(1)>";
    const plan = readPlan(200, evil);
    const html = panel(done(plan));
    expect(html).not.toContain("<img");
    expect(visibleText(html)).toContain("<img src=x onerror=alert(1)>");
  });

  test("🔴 без назви — «Unnamed campsite», і ночівля все одно в плані; без адреси — без посилання", () => {
    const body = JSON.parse(JSON.stringify(captured("plan-ok").body));
    body.days[0].night.name = null;
    body.days[0].night.path = null;
    const html = panel(done(readPlan(200, body)));
    const said = visibleText(html);
    expect(said).toContain("A night at Unnamed campsite");
    expect(said.match(/A night at/g)).toHaveLength(6);
    // Посилань на кемпінги — п'ять, а не шість: без адреси посилатися нема на що.
    expect([...html.matchAll(/href="\/camping\//g)]).toHaveLength(5);
  });

  test("🔴 головне — завжди, і числа в ньому — ті, що дав сервер: виміряні відстані, а не «найкраще підходить»", () => {
    const said = visibleText(planHtml());
    expect(said).not.toMatch(/best fit/i);
    for (const [i, n] of nightsOf().entries()) {
      expect(said, n.slug).toContain(
        `On an even split of the trip, day ${i + 1} would end ${distance(n.fromTargetM)} from this campsite. It lies ${distance(n.offsetM)} to the side of the straight line`,
      );
    }
  });

  test("🔴 причини — лише записане: «зважене» і «поруч» розділені, бо «обрано за» можна сказати лише про перше", () => {
    const html = planHtml();
    const said = visibleText(html);
    for (const n of nightsOf()) {
      for (const r of n.reasons) expect(said, `${n.slug}: ${r.field}`).toContain(r.text);
    }
    // Кожна причина, яку бал зважив, стоїть після «It also scored for», кожна, яку ні, — після «Also nearby».
    const scored = said.split("It also scored for:").length - 1;
    const nearby = said.split("Also nearby, not part of the score:").length - 1;
    const withWeighed = nightsOf().filter((n) => n.reasons.some((r) => r.weighed)).length;
    const withNear = nightsOf().filter((n) => n.reasons.some((r) => !r.weighed)).length;
    expect(scored).toBe(withWeighed);
    expect(nearby).toBe(withNear);
    expect(withWeighed).toBeGreaterThan(0);
    expect(withNear).toBeGreaterThan(0);
  });

  test("запис без причин не вдає, що їх знає: «більше нічого не записано»", () => {
    const body = JSON.parse(JSON.stringify(captured("plan-ok").body));
    body.days[0].night.reasons = [];
    const said = visibleText(panel(done(readPlan(200, body))));
    expect(said).toContain("Our data holds nothing else about this campsite to add.");
  });

  test("🔴 зручності: записане називається, незаписане — «не записано», а не «немає»", () => {
    const said = visibleText(planHtml());
    expect(said).toContain("Recorded: electricity; drinking water; grey-water disposal.");
    // Підпис із власною комою не плутається з розділювачем переліку.
    expect(said).toContain("wheelchair access, incl. limited; step-free wheelchair access.");
    expect(said).toContain("Anything not listed is not recorded, which is not the same as not there.");
    // Записане «ні» — окремо й іншими словами, ніж незаписане.
    expect(said).toContain("Recorded as not there:");
    // Мітки — ті, що на сторінці кемпінгу, а не свої.
    for (const label of ["Electricity", "Drinking water", "Grey-water disposal"]) {
      expect(Object.values(AMENITY_LABEL)).toContain(label);
    }
  });

  test("🔴 джерело й дата стоять поруч із записом — і зірки DATAtourisme не лишаються без атрибуції", () => {
    const html = planHtml();
    const said = visibleText(html);
    // Ночівля зі зірками з вторинного рядка: обидва джерела, з датами своїх записів.
    expect(said).toContain("DATAtourisme. Last updated by the source on 7 September 2026.");
    expect(said).toContain("OpenStreetMap. Last checked against this source on 16 October 2026.");
    // Один рядок джерел на ночівлю: шість.
    expect([...html.matchAll(/Last checked against this source on/g)]).toHaveLength(6);
    // Ліцензії — посиланнями, лише для тих джерел, що справді в плані.
    expect(said).toContain("Campsite records come from OpenStreetMap (Open Database License (ODbL)), DATAtourisme (Licence Ouverte 2.0 (Etalab)).");
    expect(html).toContain('href="https://opendatacommons.org/licenses/odbl/1-0/"');
    expect(html).toContain('href="https://www.etalab.gouv.fr/licence-ouverte-open-licence/"');
  });

  test("невпізнане джерело друкується, а не зникає, і без вигаданої ліцензії", () => {
    const body = JSON.parse(JSON.stringify(captured("plan-ok").body));
    body.days[0].night.sources.push({ id: "new-source", updatedAt: "2026-01-02" });
    const said = visibleText(panel(done(readPlan(200, body))));
    expect(said).toContain("new-source");
    expect(said).not.toContain("new-source (");
  });

  test("🔴 як обирали: вага кожного доданка — з відповіді, і сума сходиться до ста", () => {
    const said = visibleText(planHtml());
    expect(said).toContain("How the nights were chosen");
    for (const line of [
      "How close it is to where the day should end: 75%",
      "A recorded electric hook-up: 10%",
      "A recorded grey-water disposal point: 10%",
      "An official star classification: 5%",
    ]) {
      expect(said, line).toContain(line);
    }
    expect(said).toContain("This is not a quality rating.");
    expect(said).toContain("is not marked down for it; it only earns no bonus");
    // Кількість кандидатів — з відповіді.
    if (PLAN.status !== "planned") throw new Error("fixture is not a plan");
    expect(said).toContain(
      `${PLAN.plan.candidates.toLocaleString("en-GB")} campsites near that line`,
    );
  });

  test("🔴 ваги беруться з ВІДПОВІДІ: інша відповідь — інші числа на сторінці", () => {
    const body = JSON.parse(JSON.stringify(captured("plan-ok").body));
    body.ranking = [
      { id: "distance_fit", weight: 0.6 },
      { id: "stars", weight: 0.4 },
    ];
    const said = visibleText(panel(done(readPlan(200, body))));
    expect(said).toContain("How close it is to where the day should end: 60%");
    expect(said).toContain("An official star classification: 40%");
    expect(said).not.toContain("75%");
  });

  test("доданок без підпису друкується під своїм id, а не зникає з пояснення", () => {
    const body = JSON.parse(JSON.stringify(captured("plan-ok").body));
    body.ranking.push({ id: "scenery", weight: 0 });
    expect(visibleText(panel(done(readPlan(200, body))))).toContain("scenery: 0%");
  });

  test("кожен доданок рейтингу з відповіді має підпис — перелік підписів повний", () => {
    if (PLAN.status !== "planned") throw new Error("fixture is not a plan");
    const said = visibleText(planHtml());
    for (const t of PLAN.plan.ranking) {
      expect(said, t.id).not.toContain(`${t.id}:`);
    }
  });

  test("🔴 «ми це не зберігаємо» — лише в плані, де запит справді дійшов і де це відомо", () => {
    expect(visibleText(planHtml())).toContain(
      "the points of each leg of your trip and its number of days were sent to our server. We do not store them. The trip is kept in this browser only if you press Save this trip.",
    );
    // Коли джерело ВПАЛО, ми не знаємо, чи воно щось отримало, і не кажемо.
    const failed = visibleText(panel(done({ status: "failed" })));
    expect(failed).not.toContain("not store");
    expect(failed).not.toContain("not saved");
    expect(failed).not.toContain("sent to our server");
  });

  test("запит повторено словами й числами: що відправили, те й видно", () => {
    const said = visibleText(planHtml());
    expect(said).toContain("What you asked for");
    for (const part of ["45.764, 4.8357", "41.3874, 2.1686", "7"]) {
      expect(said, part).toContain(part);
    }
  });

  test("не малює нічого, що схоже на мапу: ні полотна, ні svg, ні таблиці", () => {
    for (const run of [panel({ phase: "idle" }), planHtml()]) {
      expect(run).not.toMatch(/<canvas|<svg|<table/);
    }
  });

  test("список днів — один впорядкований список із назвою для екранного читача", () => {
    const html = planHtml();
    expect([...html.matchAll(/<ol\b/g)]).toHaveLength(1);
    expect(html).toContain('aria-label="The days of the trip"');
    expect([...html.matchAll(/<li\b[^>]*>\s*<h4\b/g)]).toHaveLength(7);
  });

  test("слова «in a straight line» — ті самі, що на сторінках маршрутів", () => {
    // Дві копії однієї фрази (routes.ts не імпортується в клієнтський бандл —
    // він тягне дані маршрутів). Звірено тут.
    expect(STRAIGHT_LINE).toBe(STRAIGHT_LINE_LABEL);
  });

  test("distance: до кілометра — метри, до десяти — з десятою, далі — цілі", () => {
    expect(distance(0)).toBe("0 m");
    expect(distance(89.6)).toBe("90 m");
    expect(distance(999.4)).toBe("999 m");
    expect(distance(1000)).toBe("1.0 km");
    expect(distance(2616)).toBe("2.6 km");
    expect(distance(9949)).toBe("9.9 km");
    expect(distance(10_000)).toBe("10 km");
    expect(distance(53_810)).toBe("54 km");
    expect(distance(1_240_000)).toBe("1,240 km");
  });

  // ── відмови планувальника ──

  test("🔴 «ланцюжка немає» — відповідь, а не збій: з числами сервера й без вигаданого плану", () => {
    const o = outcomeOf("plan-no-chain");
    const said = visibleText(panel(done(o)));
    if (o.status !== "refused" || o.reason !== "no-chain") throw new Error("fixture");
    expect(said).toContain("No plan found.");
    expect(said).toContain(
      `it ran out after ${o.reachedNights} of ${o.daysAsked - 1} nights, with ${o.candidates} campsites near the line`,
    );
    expect(said).toContain("Nothing was made up to fill the gap.");
    expect(said).toContain("open water");
    expect(said).not.toContain("did not answer");
    expect(said).not.toContain("A night at");
    expect(said).not.toMatch(/Day \d/);
  });

  test("🔴 коло — «ні»: точка A дорівнює B, і сказано, що петель планувальник не планує", () => {
    const said = visibleText(panel(done(outcomeOf("plan-round-trip"))));
    expect(said).toContain("No plan for a round trip.");
    expect(said).toContain("does not plan loops");
    expect(said).not.toContain("did not answer");
  });

  test("🔴 поза ЄС: називає, яка саме точка, і підказує про порядок — зі справжнім прикладом", () => {
    const said = visibleText(panel(done(outcomeOf("plan-outside-union"))));
    expect(said).toContain("The start is outside the European Union.");
    expect(said).toContain("latitude comes first");
    expect(said).toContain(`Ljubljana is ${EXAMPLE.from}`);
    const both = visibleText(
      panel(done({ status: "outside-union", fields: ["from", "to"] })),
    );
    expect(both).toContain("The start and the destination are outside the European Union.");
    const end = visibleText(
      panel(done({ status: "outside-union", fields: ["to"] })),
    );
    expect(end).toContain("The destination is outside the European Union.");
  });

  test("🔴 ліміт: каже «забагато планів», а не «не відповів», і лишає людині її відповіді", () => {
    const said = visibleText(panel(done(outcomeOf("plan-throttled"))));
    expect(said).toContain("Too many plans in a minute.");
    expect(said).toContain("still in the form");
    expect(said).not.toContain("did not answer");
  });

  test("🔴 збій: каже про збій, лишає людині її відповіді й не вдає результату", () => {
    const said = visibleText(panel(done({ status: "failed" })));
    expect(said).toContain("The planner did not answer.");
    expect(said).toContain("still in the form");
    expect(said).not.toContain("No plan");
    expect(said).not.toContain("What you asked for");
    expect(said).not.toContain("A night at");
  });

  test("🔴 слова «не рахує» немає ніде: планувальник рахує", () => {
    for (const o of [PLAN, outcomeOf("plan-no-chain"), { status: "failed" } as PlanOutcome]) {
      expect(visibleText(panel(done(o)))).not.toMatch(
        /does not calculate|not calculate routes|No route to show/i,
      );
    }
  });
});

// ── Сторінка ──────────────────────────────────────────────────────────

test.describe("сторінка /plan", () => {
  const page = () => renderComponent(PlanPage, {});

  test("🔴 каже прямо, що планувальник робить, — у виданому HTML і ПЕРЕД формою", () => {
    const said = visibleText(page());
    const verdict = said.indexOf("This planner cuts a straight line into days.");
    const formStart = said.indexOf("Your trip");
    expect(
      verdict,
      "речення немає в видимому тексті сторінки",
    ).toBeGreaterThanOrEqual(0);
    expect(formStart).toBeGreaterThan(verdict);
  });

  test("🔴 каже, чого він НЕ знає: доріг, розміру транспорту, дат відкриття — і чому приймає координати", () => {
    const said = visibleText(page());
    expect(said).toContain("What it does not know:");
    expect(said).toContain("the roads, so every distance is a straight line and there are no driving times");
    expect(said).toContain("the size of your vehicle, because we hold no data on pitch sizes");
    expect(said).toContain("whether a campsite is open on your dates");
    expect(said).toContain("Place names are looked up in our own data only, as they are written locally.");
    expect(said).toContain("the height, length and weight you enter are saved with the trip and change nothing in the plan");
    expect(said).not.toContain("nothing looks names up yet");
  });

  test("🔴 застереження («лише для інформації, не навігація, на власний ризик») — у виданому HTML, ПЕРЕД формою, і з посиланням на правову сторінку", () => {
    const html = page();
    const node = /<p\b[^>]*data-testid="plan-disclaimer"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(node, "вузла застереження немає в виданому HTML").not.toBeNull();
    const said = visibleText(node![1]);
    expect(said).toContain("For your information only.");
    expect(said).toContain("Everything here may differ from real conditions.");
    expect(said).toContain("CampTribe is not a navigation app.");
    expect(said).toContain("can be wrong or out of date");
    expect(said).toContain("you use this at your own discretion and risk");
    expect(node![1]).toContain('href="/legal/disclaimer"');
    // Перед формою, а не після неї й не в підвалі.
    const all = visibleText(html);
    expect(all.indexOf("For your information only.")).toBeGreaterThanOrEqual(0);
    expect(all.indexOf("For your information only.")).toBeLessThan(all.indexOf("Your trip"));
  });

  test("🔴 і не каже старого: що не рахує й що «зʼявиться, коли запрацює»", () => {
    const said = visibleText(page());
    expect(said).not.toMatch(/does not calculate|not calculate routes|when it works|route drawn on a map/i);
  });

  test("🔴 дії на сторінці — лише ті, що названі: форма, проміжні точки, збереження; акаунта й конверсійних дій немає", () => {
    // Картка просить мапу й зупинки. «Зберегти в кабінет» і «поділитись»
    // — окремі дії, яким потрібен кабінет, якого немає. Перевіряється
    // властивість («які дії є»), а не список слів, які сторінка могла б
    // сказати: будь-яка нова кнопка чи посилання червонить цей тест,
    // хоч би яким словом її підписано.
    const html = page();
    const buttons = controls(html)
      .filter((c) => c.tag === "button")
      .map((c) => ({ type: c.attrs.type, id: c.attrs["data-testid"] ?? null }));
    expect(buttons).toEqual([
      { type: "button", id: "add-via" },
      { type: "submit", id: null },
      { type: "button", id: "save-trip" },
      { type: "button", id: "share-trip" },
    ]);
    expect(visibleText(/<button\b[^>]*type="submit"[\s\S]*?<\/button>/.exec(html)![0])).toBe(
      "Check my trip",
    );

    expect([...html.matchAll(/<form\b/g)]).toHaveLength(1);
    const hrefs = [...html.matchAll(/<a\b([^>]*)>/g)]
      .map((m) => attrsOf(m[1]).href)
      .sort();
    expect(hrefs).toEqual(["/legal/disclaimer", "/map", "/routes", "/tools/camper-trip-cost"]);
  });

  test("«на сайті ще» веде в три справжні місця, а не в порожнечу", () => {
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
    // `/search` — той самий прецедент. Планувальник уже рахує, але доріг у
    // нього немає (маршрутизатора немає), і сторінка не для пошуку, доки
    // немає. Коли дороги з'являться, цей тест червоніє навмисно: три речі
    // міняються разом (див. коментар у app/plan/page.tsx).
    expect(metadata.robots).toEqual({ index: false, follow: true });
    const paths = STATIC_HUBS.map((u) => new URL(u.loc).pathname);
    expect(paths).not.toContain("/plan");
  });

  test("метадані: заголовок, опис, що не обіцяє доріг, канонічна адреса", () => {
    expect(metadata.title).toBe("Trip planner");
    const description = String(metadata.description);
    expect(description).toContain("Distances are straight lines, not roads.");
    expect(description).not.toMatch(/does not calculate/i);
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
