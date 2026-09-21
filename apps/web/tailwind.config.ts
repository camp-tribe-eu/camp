import type { Config } from "tailwindcss";

/**
 * A token colour that survives the opacity modifier.
 *
 * 🔴 Why this is not just `"var(--ok)"`: Tailwind compiles `bg-ok/10` to
 * `rgb(var(--ok) / 0.1)`, which is only valid if the variable holds channel
 * numbers. Ours hold hex, because the mock-ups in Design/_base.css do — so
 * the browser gets `rgb(#4ba883 / 0.1)`, throws it away, and the element
 * renders fully transparent while `border-ok/50` silently falls back to
 * Tailwind's default grey. No error anywhere; it was found by rendering the
 * page and reading the computed style.
 *
 * color-mix keeps the hex form, so the tokens here and in the mock-ups stay
 * the same file's worth of values. `<alpha-value>` is Tailwind's own
 * placeholder: it becomes `1` when no modifier is used, so a plain `bg-ok`
 * resolves to a 100% mix, which is the colour itself.
 */
const token = (name: string) =>
  `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // CAMP-34: every colour points at a CSS variable rather than holding a
      // hex value, so the three theme states in globals.css switch the whole
      // palette without Tailwind knowing a theme exists. A hex here would be
      // a fourth source of truth and would not follow dark mode.
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        "accent-surface": token("accent-surface"),
        ink: token("ink"),
        "ink-2": token("ink-2"),
        "ink-3": token("ink-3"),
        heading: token("heading"),
        line: token("line"),
        "line-2": token("line-2"),
        "line-blue": token("line-blue"),
        ok: token("ok"),
        warn: token("warn"),
        amber: token("amber"),
        btn: token("btn"),
        "btn-hover": token("btn-hover"),
        "btn-ink": token("btn-ink"),
      },
      borderRadius: {
        DEFAULT: "var(--r-sm)",
        card: "var(--r)",
        sm: "var(--r-xs)",
        xs: "var(--r-xxs)",
      },
      boxShadow: { card: "var(--shadow)" },
      // Measured from the live theme, not Tailwind's defaults (md/lg/xl are
      // 768/1024/1280 out of the box, and 1024 is not one of our steps).
      screens: { md: "768px", lg: "992px", xl: "1200px" },
      maxWidth: { wrap: "1180px", prose: "61ch" },
      // CAMP-88. `sans` is overridden rather than added so that Tailwind's
      // default utilities (and anything that inherits them) use Archivo
      // instead of the stock stack — otherwise a stray `font-sans` somewhere
      // silently falls back to system fonts and the page looks half-styled.
      fontFamily: {
        sans: ["var(--font-sans)"],
        narrow: ["var(--font-narrow)"],
      },
    },
  },
  plugins: [],
};
export default config;
