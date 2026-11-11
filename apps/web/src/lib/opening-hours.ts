// CAMP-463: OpenStreetMap's `opening_hours` for a reader.
//
// 🔴 ЧОМУ ЦЕ ІСНУЄ. На сторінці маршруту й кемпінгу читач бачив сирий
// рядок мапи: `Mo 15:30-19:45; Tu-Sa 08:30-13:00,15:30-19:45`. Це
// машинний формат, і розповідав він читачеві про наш імпорт, а не про
// години роботи.
//
// 🔴 А ПОПЕРЕДНЄ РІШЕННЯ «НЕ ПЕРЕКЛАДАТИ» (route-services.tsx, CAMP-141)
// ЛИШАЄТЬСЯ В СИЛІ, І ЦЕЙ ФАЙЛ ЙОГО НЕ СКАСОВУЄ. Там заміряно: з 683 603
// значень 58,6% несуть місяці, `PH`, `off`, `sunrise` чи коментар, і
// «Mo-Su 08:00-20:00; PH off», переписане як «щодня», бреше саме в
// державне свято. Тому розбір тут — ВСЕ АБО НІЧОГО, як у
// `schemaOpeningHours`: значення або розібране ПОВНІСТЮ в граматиці, яку
// ми розуміємо точно, або `null`, і тоді компонент показує оригінал під
// спойлером «Opening hours as recorded», а не в тілі сторінки.
//
// Граматика, навмисно вузька:
//
//   value  = "24/7" | rule (";" rule)*
//   rule   = days SP times | days SP ("off" | "closed")
//   days   = day-spec ("," day-spec)*       day-spec = DAY | DAY "-" DAY
//   times  = HH:MM-HH:MM ("," HH:MM-HH:MM)*
//
// Усе, що поза нею (місяці, PH, sunrise, коментарі в лапках, «Sa-Mo»
// через тиждень, правило, що знову називає вже названий день), — `null`.
// Той самий день у двох правилах в OSM означає «пізніше правило
// перекриває», тобто читати його «додаванням» було б брехнею.

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const LONG: Record<(typeof DAYS)[number], string> = {
  Mo: 'Mon',
  Tu: 'Tue',
  We: 'Wed',
  Th: 'Thu',
  Fr: 'Fri',
  Sa: 'Sat',
  Su: 'Sun',
};

const DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const SPEC_RE = `${DAY_RE}(?:-${DAY_RE})?`;
const RANGE_RE = '\\d{2}:\\d{2}-\\d{2}:\\d{2}';
const RULE_RE = new RegExp(
  `^(${SPEC_RE}(?:,${SPEC_RE})*) (${RANGE_RE}(?:,${RANGE_RE})*|off|closed)$`,
);

const dayIndex = (d: string): number => DAYS.indexOf(d as (typeof DAYS)[number]);

/** `08:30-13:00` → `08:30–13:00`, or null when it is not a clock. */
function range(r: string): string | null {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(r);
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number);
  if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  if ((h1 === 24 && m1 > 0) || (h2 === 24 && m2 > 0)) return null;
  return `${r.slice(0, 5)}–${r.slice(6)}`;
}

/** Days of one rule, as the days they cover, or null when they wrap. */
function daysOf(spec: string): { label: string; covers: number[] } | null {
  const covers: number[] = [];
  const labels: string[] = [];
  for (const part of spec.split(',')) {
    const [from, to] = part.split('-');
    const a = dayIndex(from);
    if (to === undefined) {
      covers.push(a);
      labels.push(LONG[from as keyof typeof LONG]);
      continue;
    }
    const b = dayIndex(to);
    // `Sa-Mo` wraps the week; OSM allows it and we do not read it.
    if (b <= a) return null;
    for (let i = a; i <= b; i++) covers.push(i);
    labels.push(
      `${LONG[from as keyof typeof LONG]}–${LONG[to as keyof typeof LONG]}`,
    );
  }
  return { label: labels.join(', '), covers };
}

/**
 * The hours in words, or `null` when any part of the value is outside the
 * grammar in the header of this file. Never a partial reading.
 */
export function humanOpeningHours(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value === '') return null;
  if (value === '24/7') return 'Open around the clock, every day';

  const rules = value.split(';').map((r) => r.trim());
  // A trailing `;` leaves an empty rule — that is a value we did not
  // parse, not one we may quietly tidy.
  if (rules.length === 0 || rules.some((r) => r === '')) return null;

  const seen = new Set<number>();
  const out: string[] = [];
  for (const rule of rules) {
    const m = RULE_RE.exec(rule);
    if (!m) return null;
    const days = daysOf(m[1]);
    if (!days) return null;
    for (const d of days.covers) {
      if (seen.has(d)) return null;
      seen.add(d);
    }
    if (m[2] === 'off' || m[2] === 'closed') {
      out.push(`${days.label} closed`);
      continue;
    }
    const times = m[2].split(',').map(range);
    if (times.some((t) => t === null)) return null;
    out.push(`${days.label} ${times.join(', ')}`);
  }
  return out.join('; ');
}
