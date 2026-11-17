/**
 * 🔴 SELECT BY THE THEME (docs/design-system-from-theme.md, «Поля вводу й
 * селекти»): `appearance: none` and OUR OWN chevron, with 40px on the
 * inline end — the theme keeps it three times the start padding, and that
 * is exactly why the chevron never touches the edge (review 442/22, 442/32).
 * The two go as a pair: without the chevron `appearance: none` makes a
 * select look like a plain text field.
 *
 * Inline SVG, not `background-image`: CSP (`img-src`) never touches it.
 */
export const SELECT_CHEVRON_ROOM = 'appearance-none pe-10';

export function SelectChevron() {
  return (
    <svg
      aria-hidden="true"
      data-testid="select-chevron"
      width="12"
      height="8"
      viewBox="0 0 12 8"
      fill="none"
      className="pointer-events-none absolute end-4 top-1/2 mt-0.5 -translate-y-1/2 text-heading"
    >
      <path
        d="M1 1.5 6 6.5 11 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
