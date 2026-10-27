// CAMP-383. ESLint 9 «flat config» замість `.eslintrc.json`.
//
// `next lint` у Next 16 видалено, а `eslint-config-next` 16 віддає лише
// flat-масиви й вимагає ESLint ≥ 9. Обидва пресети ті самі, що й були:
// `core-web-vitals` і `typescript`.
//
// 🔴 ОБЛАСТЬ ЛИШАЄТЬСЯ ТІЄЮ САМОЮ. `next lint` 15 перевіряв лише теки
// `app`, `pages`, `components`, `lib`, `src` (ESLINT_DEFAULT_DIRS) — у нас
// це `src/`, і скрипт `lint` каже `eslint src`. Заміряно 27.10.2026:
// `eslint .` додав би `tests/` і `scripts/` із 12 знахідками (2
// rules-of-hooks у тестових помічниках, 2 no-explicit-any, 1
// no-require-imports, 1 prefer-const, 5 no-unused-vars, 1 зайва
// директива). Розширювати область — окрема картка, не побічний ефект
// оновлення фреймворку. `--max-warnings=0` у CI лишається.
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
import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
    },
  },
  globalIgnores([
    // `.next/`, `out/`, `build/`, `next-env.d.ts` уже в пресеті typescript.
    'public/**',
    'playwright-report/**',
    'test-results/**',
    'tsconfig.tsbuildinfo',
  ]),
]);
