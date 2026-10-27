import {
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// CAMP-147: render a React component to HTML inside a Playwright test.
//
// 🔴 WHY THIS BRIDGE HAS TO EXIST, so nobody deletes it as clever.
//
// Playwright compiles JSX with its OWN runtime, and not by choice of
// ours: on the version this lock pins (1.63.0) `jsxImportSource` is
// hard-coded to the playwright package in
// `playwright/lib/common/index.js`, with no tsconfig input. Both
// `apps/web/tests/tsconfig.json` and `apps/web/src/tsconfig.json` with
// `"jsx": "react-jsx"` were tried and changed nothing. So every `<div>`
// in the component comes out as `{__pw_type: 'jsx', type, props, key}`
// and React answers "Objects are not valid as a React child".
//
// 🔴 ЦЕ ТВЕРДЖЕННЯ МАЄ ВЕРСІЮ, І ВОНА ВЖЕ НЕ ОСТАННЯ. Рецензія
// PR #297 розпакувала 1.64.1: там `jsx-runtime.js` НЕМАЄ зовсім, а
// `lib/common/index.js` читає `jsxImportSource` із tsconfig. Тобто
// під 1.64 цей міст стає тотожним прокиданням і більше не потрібен —
// а канарка нижче наказує «лагодити в isPwNode», тобто його зберегти.
//
// Коли дійде до підйому Playwright, рішення буде не «полагодити
// isPwNode», а «перевірити, чи міст іще потрібен». Записано тут, бо
// саме цей абзац читають першим.
//
// The alternatives were worse. Adding jest or vitest to apps/web is a
// new test runner and new dependencies in a public repository that gates
// on dependency advisories. Asserting on the Playwright objects directly
// would test a tree we invented rather than the HTML a reader is served.
// This converts one element format to the other and then uses the real
// `renderToStaticMarkup` — the same call the static export makes.
//
// 🔴 It cannot make a failing component pass. It only rewrites node
// shape: text, attributes and structure come from the component, and if
// this bridge dropped children every assertion below it would fail
// rather than succeed. `rendersNothing` exists so the two "" cases
// cannot be satisfied by a silently broken bridge.

type PwNode = {
  __pw_type: string;
  type: unknown;
  props?: Record<string, unknown>;
  key?: unknown;
};

const isPwNode = (v: unknown): v is PwNode =>
  !!v && typeof v === 'object' && (v as PwNode).__pw_type === 'jsx';

/**
 * A function component, wrapped so React gets React elements back.
 *
 * Memoised because React uses the function identity as the element type;
 * a fresh wrapper per call would make every render a different component.
 */
const wrappers = new WeakMap<object, (props: unknown) => ReactNode>();

function wrapType(fn: (props: unknown) => unknown): (p: unknown) => ReactNode {
  const seen = wrappers.get(fn);
  if (seen) return seen;
  const wrapper = (props: unknown): ReactNode => toReact(fn(props)) as ReactNode;
  Object.defineProperty(wrapper, 'name', { value: fn.name || 'Component' });
  wrappers.set(fn, wrapper);
  return wrapper;
}

/**
 * Component types `renderAsyncComponent` was told to leave out. Empty
 * except for the duration of one such call.
 */
let omitted: ReadonlySet<unknown> = new Set();

function toReact(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toReact);
  if (!isPwNode(node)) return node;
  if (omitted.has(node.type)) return null;

  const { children, ...rest } = (node.props ?? {}) as Record<string, unknown>;
  const kids =
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children];

  // `<>…</>` arrives as `{__pw_jsx_fragment: …}`, which React reads as an
  // invalid element type ("expected a string … but got: object"). It is
  // React's Fragment by any other name.
  const isFragment =
    !!node.type &&
    typeof node.type === 'object' &&
    '__pw_jsx_fragment' in (node.type as object);

  const type = isFragment
    ? Fragment
    : typeof node.type === 'function'
      ? wrapType(node.type as (props: unknown) => unknown)
      : (node.type as string);

  return createElement(
    type,
    { ...rest, key: node.key as string | number | null | undefined },
    ...(kids.map(toReact) as ReactNode[]),
  );
}

/** A component called with props, rendered to the HTML a reader gets. */
export function renderComponent<P>(
  Component: (props: P) => unknown,
  props: P,
  // 🔴 Та сама опція, що й у асинхронного брата нижче, і з тієї ж
  // причини: компонент мапи тягне MapLibre, який у статичному рендері
  // не живе. Без неї синхронний компонент із мапою всередині взагалі не
  // можна перевірити рендером — а саме рендер і треба перевіряти.
  options: { omit?: unknown[] } = {},
): string {
  omitted = new Set(options.omit ?? []);
  try {
    return renderToStaticMarkup(toReact(Component(props)) as ReactElement);
  } finally {
    omitted = new Set();
  }
}

/**
 * CAMP-160: an ASYNC server component — a Next page — rendered to the
 * HTML a reader is served.
 *
 * 🔴 Awaited first, then converted, so the page's own data fetching runs
 * for real (against whatever `fetch` the test has swapped in). This is
 * what lets a spec assert on the page's OUTPUT rather than on the
 * pieces it is assembled from: a component and a data function can each
 * be correct while the page hands the one the wrong flag from the other.
 *
 * `omit` names component types to render as nothing. It exists for one
 * reason: a client-only island (the route map, `next/dynamic` with
 * `ssr: false`) builds its loading fallback with real React from inside
 * Next, which hands this bridge a Playwright node it cannot reach. The
 * island renders no text a reader could be told anything from, so it is
 * left out rather than made to work; everything else on the page is
 * rendered as served.
 */
export async function renderAsyncComponent<P>(
  Component: (props: P) => Promise<unknown>,
  props: P,
  options: { omit?: unknown[] } = {},
): Promise<string> {
  const tree = await Component(props);
  omitted = new Set(options.omit ?? []);
  try {
    return renderToStaticMarkup(
      toReact(await resolveAsync(tree)) as ReactElement,
    );
  } finally {
    omitted = new Set();
  }
}

/**
 * Async server components NESTED in the tree, awaited before the render.
 *
 * `renderToStaticMarkup` is synchronous: a child that is itself an
 * `async function` (the region hub's `RegionNeighbours`, which fetches
 * the sibling regions) makes it throw "A component suspended while
 * responding to synchronous input", and the page cannot be checked at
 * all. This pass walks the Playwright-shaped tree, calls each async
 * component with its props — so its own fetching runs for real, against
 * whatever `fetch` the test swapped in, exactly as the page's does —
 * and puts what it returned where the element stood. Omitted types are
 * left alone for `toReact` to drop, so an omitted island is never run.
 *
 * 🔴 It cannot make a failing component pass, for the same reason the
 * bridge above cannot: it only replaces an element with that element's
 * own output.
 */
async function resolveAsync(node: unknown): Promise<unknown> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveAsync));
  if (!isPwNode(node)) return node;
  if (omitted.has(node.type)) return node;
  const type = node.type as { constructor?: { name?: string } };
  if (typeof type === 'function' && type.constructor?.name === 'AsyncFunction') {
    const out = await (node.type as (p: unknown) => Promise<unknown>)(
      node.props ?? {},
    );
    return resolveAsync(out);
  }
  const children = node.props?.children;
  if (children === undefined) return node;
  return {
    ...node,
    props: { ...node.props, children: await resolveAsync(children) },
  };
}

/**
 * True when a component genuinely rendered nothing.
 *
 * 🔴 Asserting `=== ''` alone would also pass if this bridge were
 * broken, which is the one way a test here could go green over a defect.
 * This checks the component itself returned nothing before trusting the
 * empty string.
 */
export function rendersNothing<P>(
  Component: (props: P) => unknown,
  props: P,
): boolean {
  const out = Component(props);
  return (out === null || out === undefined) && renderComponent(Component, props) === '';
}

/**
 * 🔴 КАНАРКА НА ВНУТРІШНЮ ПОЗНАЧКУ PLAYWRIGHT.
 *
 * Усе, що нижче цього файла, тримається на тому, що Playwright
 * позначає скомпільований JSX як `__pw_type: 'jsx'`. Це його ВНУТРІШНЄ
 * представлення, не оголошений інтерфейс — отже воно може поїхати на
 * будь-якому підйомі версії, і ми на це не маємо права скаржитись.
 *
 * Заміряно 20.10.2026 під час CAMP-351: перегенерація lock-файла
 * підняла Playwright 1.63 → 1.64, і два тести впали з
 * `Received: undefined` — повідомленням, яке нічого не каже про
 * причину. Я півгодини шукав дефект у залежностях продукту, а він був
 * у нашому ж хелпері.
 *
 * Ця функція перетворює той тихий провал на гучний: вона падає з
 * діагнозом у тексті, а не лишає порожні вузли мандрувати далі.
 *
 * 🔴 Чому саме тут, а не окремим тестом: окремий тест можна не
 * запустити. Ця перевірка виконується при ІМПОРТІ хелпера, тобто в
 * кожному тесті, який ним користується.
 */
function assertPlaywrightJsxShape(): void {
  // 🔴 ЗОНД ПОВЕДІНКОВИЙ, А НЕ НА ПОЗНАЧКУ.
  //
  // Перша редакція питала лише `isPwNode(probe)`. Рецензія PR #297
  // довела матрицею, що цього мало: зміна, яка ЛИШАЄ `__pw_type: 'jsx'`,
  // але переносить `children` з `props` на сам вузол, канарку не
  // чіпає — а набір потім падає в `security-log-policy.spec.ts` із
  // «у політиці немає розділу The security log». Тобто рівно той хибний
  // діагноз, заради якого ця канарка й існує.
  //
  // Тому зонд має вкладену дитину й перевіряє ВЕСЬ шлях, яким
  // користуються тести: позначка → обхід → пошук за testId.
  const probe = (
    <span data-probe="outer">
      <em data-testid="probe-inner" />
    </span>
  ) as unknown;

  const markerOk = isPwNode(probe);
  const walkOk = markerOk && walkJsx(probe).length === 2;
  const findOk = walkOk && !!byTestId(probe, 'probe-inner');
  if (findOk) return;

  // 🔴 ДРУКУЄМО ЗНАЧЕННЯ ПОЗНАЧКИ, А НЕ ПЕРЕЛІК КЛЮЧІВ.
  //
  // Перша редакція друкувала `Object.keys`, і при зміні самого
  // ЗНАЧЕННЯ повідомлення суперечило собі: «більше не позначає як
  // __pw_type: 'jsx' (отримано ключі: __pw_type, type, props, key)».
  // Доказ заперечував твердження. Назвала рецензія.
  const o = probe && typeof probe === 'object' ? (probe as Record<string, unknown>) : null;
  const marker = o ? JSON.stringify(o.__pw_type) : typeof probe;
  const keys = o ? Object.keys(o).join(', ') : '—';
  const stage = !markerOk ? 'позначка' : !walkOk ? 'обхід дерева' : 'пошук за testId';

  throw new Error(
    `render-component: форма JSX від Playwright змінилась — зламано на кроці «${stage}».\n` +
      `  __pw_type = ${marker}; ключі вузла: ${keys}\n` +
      `  вузлів у зонді: ${markerOk ? walkJsx(probe).length : 0} (очікували 2)\n` +
      'Це НЕ дефект компонента й не дефект тесту, що впав поруч.\n' +
      'Полагодити — у цьому файлі (`isPwNode`, `walkJsx`), і більше ' +
      'ніде: решта місць ходить через них. Див. CAMP-351.',
  );
}

assertPlaywrightJsxShape();

/**
 * Усі вузли дерева, у глибину. Єдиний обхід на весь набір тестів —
 * щоб знання про формат Playwright жило в одному місці.
 *
 * 🔴 `map-overnight.spec.ts` мав власну копію цього обходу з власною
 * перевіркою `__pw_type`, і саме вона мовчки зламалась на підйомі
 * 1.63 → 1.64. Дублювання тут коштувало двох годин пошуку не там.
 */
export function walkJsx(node: unknown, out: PwNode[] = []): PwNode[] {
  if (Array.isArray(node)) {
    for (const n of node) walkJsx(n, out);
  } else if (isPwNode(node)) {
    out.push(node);
    walkJsx(node.props?.children, out);
  }
  return out;
}

/** Перший вузол із цим `data-testid` (або пропом `testId`). */
export function byTestId(tree: unknown, id: string): PwNode | undefined {
  return walkJsx(tree).find(
    (n) => n.props?.['data-testid'] === id || n.props?.testId === id,
  );
}
