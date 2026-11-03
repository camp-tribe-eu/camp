// CAMP-383. ESLint 9 «flat config» замість `.eslintrc.json`.
//
// `next lint` у Next 16 видалено, а `eslint-config-next` 16 віддає лише
// flat-масиви й вимагає ESLint ≥ 9. Обидва пресети ті самі, що й були:
// `core-web-vitals` і `typescript`.
//
// 🔴 ОБЛАСТЬ РОЗШИРЕНО 03.11.2026 — CAMP-369, і це була окрема картка,
// як і домовлялись. `next lint` 15 перевіряв лише теки `app`, `pages`,
// `components`, `lib`, `src` (ESLINT_DEFAULT_DIRS) — у нас це `src/`.
// Заміряно 27.10.2026: `eslint .` додав би `tests/` і `scripts/` із 12
// знахідками, і розширення відклали, щоб воно не стало побічним ефектом
// оновлення фреймворку.
//
// Заміряно знову 03.11.2026, уже по самих `tests/`: **13** знахідок
// (6 помилок, 7 попереджень) в 11 файлах зі 182 — за тиждень додалась
// одна. Тобто поки теку не лінтували, вона тихо набирала борг.
//
// Усі 13 закрито, `lint` тепер каже `eslint src tests`, `--max-warnings=0`
// у CI лишається. `scripts/` досі поза областю: там свій прогін
// (`npx eslint "src/**/*.ts"` у роботі `api`) і своя картка.
//
// 🔴 ДВА ПРАВИЛА ВИМКНЕНО, І ЦЕ НЕ ПОСЛАБЛЕННЯ. eslint-plugin-react-hooks
// 5.2 → 7.1 додав у `recommended` правила React Compiler:
// `set-state-in-effect` і `refs`. На нашому коді вони дають 17 + 1
// помилок — усі на свідомому шаблоні «useState(false) + useEffect(() =>
// setReady(true))», яким форми оживають лише після гідратації (див.
// `use-ready.ts`, `account-forms.tsx`). Компілятор React ми не вмикаємо,
// тож це нові сторожі, яких у репозиторії ніколи не було, а не старі,
// яких позбулись. Увімкнути їх — окреме рішення зі своїм рефакторингом.
//
// 🔴 `public/` ігнорується навмисно: туди `scripts/copy-maplibre-worker.mjs`
// копіює чужий зібраний воркер MapLibre перед кожною збіркою, і лінтити
// чужий мініфікований код — це шум, який не читає ніхто.
import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
  // 🔴 CAMP-369. ТЕСТИ ТЕПЕР ЛІНТУЮТЬСЯ, І ОДНЕ ПРАВИЛО ТАМ ВИМКНЕНО.
  //
  // `react-hooks/rules-of-hooks` падає на фікстурах Playwright: їхній
  // колбек називається `use`, і правило читає виклик `await use(ctx)` як
  // виклик React-хука «з функції, що не є компонентом». Це не React і
  // ніколи ним не буде — ім'я збіглося.
  //
  // Вимикаємо ЛИШЕ це правило й ЛИШЕ в `tests/`: усе інше там діє, і
  // саме тому цей PR почався з 13 знахідок, а не з нуля. Альтернатива —
  // два `eslint-disable` у `api-request.ts`, які довелося б дописувати
  // в кожну нову фікстуру, тобто правило без сторожа.
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      // 🔴 Підкреслення спереду вже означає «я знаю, що воно не вжите».
      // У тестах це звичайний прийом: `([, _drop, keep]) => keep`,
      // `(_grid, cell) => …`. Правило про це не знало, і чотири таких
      // імені читались як борг. Тепер конвенція записана, а не вгадується.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  globalIgnores([
    // `.next/`, `out/`, `build/`, `next-env.d.ts` уже в пресеті typescript.
    "public/**",
    "playwright-report/**",
    "test-results/**",
    "tsconfig.tsbuildinfo",
  ]),
]);
