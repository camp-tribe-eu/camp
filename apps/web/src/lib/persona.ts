/**
 * Дві людини, один сайт — CAMP-501.
 *
 * 🔴 НЕ ДВА САЙТИ. Дані ті самі; міняється порядок і подача. Вибір читача —
 * `owner` (має кемпер: місця, злив, газ, підʼїзд) або `renter` (кемпера ще
 * нема: де взяти і куди їхати) — лежить на `<html data-persona>`. Усе інше
 * робить CSS (`globals.css`, блок «CAMP-501»). Саме тому перемикач не
 * змушує сторінку гідратуватись по-іншому: серверний HTML однаковий для
 * всіх, а різниця — у двох атрибутах і правилах стилю.
 *
 * 🔴 ДРУГА КОПІЯ КЛЮЧА, І ВОНА ТУТ НАВМИСНО — так само, як `theme-bootstrap`:
 * скрипт у `<head>` не може імпортувати з клієнтського компонента, а сторож
 * правових сторінок вимагає ЛІТЕРАЛ там, де стоїть `.setItem(`
 * (`components/persona-toggle.tsx`). Розійтись не дає
 * `tests/unit/persona-key.spec.ts`.
 *
 * 🔴 НЕМАЄ ВИБОРУ — НЕМАЄ АТРИБУТА, І САЙТ ТАКИЙ, ЯКИМ ЙОГО ВІДДАЛИ ДО ЦІЄЇ
 * КАРТКИ. Жоден з двох порядків не є «типовим для всіх».
 */
const PERSONA_KEY = "camptribe.persona";

export type Persona = "owner" | "renter";

export const PERSONAS: readonly Persona[] = ["owner", "renter"];

export const isPersona = (v: unknown): v is Persona =>
  v === "owner" || v === "renter";

/** Слот сторінки CMS `persona-switch`, де лежить підпис. */
export const PERSONA_PAGE = "persona-switch";

export const PERSONA_SLOTS = [
  "switch-label",
  "owner",
  "renter",
  "route-rental",
] as const;
export type PersonaSlot = (typeof PERSONA_SLOTS)[number];

/** Скрипт у `<head>`: переносить ЗБЕРЕЖЕНИЙ вибір на `<html>` до першого малювання. */
export const PERSONA_BOOTSTRAP = `(function(){try{var p=localStorage.getItem('${PERSONA_KEY}');if(p==='owner'||p==='renter'){document.documentElement.dataset.persona=p}}catch(e){}})();`;
