import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
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
