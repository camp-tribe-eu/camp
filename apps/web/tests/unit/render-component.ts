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
// ours: `jsxImportSource` is hard-coded to the playwright package in
// `playwright/lib/common/index.js`, with no tsconfig input. Both
// `apps/web/tests/tsconfig.json` and `apps/web/src/tsconfig.json` with
// `"jsx": "react-jsx"` were tried and changed nothing. So every `<div>`
// in the component comes out as `{__pw_type: 'jsx', type, props, key}`
// and React answers "Objects are not valid as a React child".
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

function toReact(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toReact);
  if (!isPwNode(node)) return node;

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
): string {
  return renderToStaticMarkup(toReact(Component(props)) as ReactElement);
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
