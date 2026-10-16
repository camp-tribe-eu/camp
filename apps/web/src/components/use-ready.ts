import { useEffect, useState } from 'react';

/**
 * `false` до гідратації: до того форма не робить нічого, і це сказано (як на /plan,
 * /login). Той самий хук, що в account-forms.tsx, окремим файлом для сторінок
 * CAMP-229 (3/3) — щоб не чіпати чужий файл заради п'яти рядків.
 */
export function useReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}
