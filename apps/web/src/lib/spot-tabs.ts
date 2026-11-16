// CAMP-453 — які таби має сторінка кемпінгу, і чому саме ці.
//
// Власник (CAMP-441/66): «мапа, погода, камери, тривоги — у вигляді табів».
//
// 🔴 ТАБ МАЄ ПРАВО НА ІСНУВАННЯ ЛИШЕ ТАМ, ДЕ Є ЩО ПОКАЗАТИ. Порожній таб —
// це кнопка, що веде до «нічого», а читач вирішує, що сторінка зламана.
// Рішення про наявність таба приймається ТУТ, одним місцем, з тих самих
// вхідних, з яких сторінка вирішує, чи малювати панель, — а не двома
// списками, що розійдуться першого ж дня.
//
// 🔴 «ПОГОДА» СТОЇТЬ У ПЕРЕЛІКУ, АЛЕ СТОРІНКА ЇЇ НЕ ПЕРЕДАЄ. Джерела
// прогнозу в коді немає (CAMP-477: компонента й виклику не існує, а
// безкоштовний API Open-Meteo некомерційний — лист 10.11.2026 дозволяє
// лише дані з S3, які ми ще не тягнемо). Тому `weather` на сторінці
// кемпінгу завжди `false`, і таба немає. Порядок, мітка й правило «немає
// даних — немає таба» уже тут і під тестом, тож коли CAMP-477 принесе
// дані, зміниться один прапорець, а не розкладка.

export type SpotTabId = 'map' | 'weather' | 'webcams' | 'alerts';

/**
 * Порядок і підписи. Один словник на всю сторінку: підпис таба й
 * `aria-label` панелі беруться звідси, а не набираються двічі.
 */
export const SPOT_TAB_ORDER: readonly SpotTabId[] = ['map', 'weather', 'webcams', 'alerts'];

export const SPOT_TAB_LABEL: Readonly<Record<SpotTabId, string>> = {
  map: 'Map',
  weather: 'Weather',
  webcams: 'Webcams',
  alerts: 'Alerts',
};

export type SpotTab = { id: SpotTabId; label: string };

/**
 * Які таби малювати.
 *
 * `map` — завжди: сторінка кемпінгу без мапи не існує (це її медіа, коли
 * фото немає). Решта — лише коли відповідний прапорець явно `true`.
 * Відсутній ключ — це `false`, а не «невідомо»: таб без підтвердженого
 * вмісту не малюється.
 */
export function spotTabs(has: Partial<Record<Exclude<SpotTabId, 'map'>, boolean>>): SpotTab[] {
  return SPOT_TAB_ORDER.filter((id) => id === 'map' || has[id as Exclude<SpotTabId, 'map'>] === true).map(
    (id) => ({ id, label: SPOT_TAB_LABEL[id] }),
  );
}

/** Ідентифікатор панелі в розмітці: лінк без JS і `aria-controls` із JS. */
export const spotPanelId = (id: SpotTabId): string => `spot-panel-${id}`;
export const spotTabButtonId = (id: SpotTabId): string => `spot-tab-${id}`;

/**
 * Наступний таб за клавішею. Стрілки йдуть по колу, Home/End — до країв;
 * будь-яка інша клавіша — `null` (не наша).
 */
export function nextTab(
  tabs: readonly SpotTab[],
  current: SpotTabId,
  key: string,
): SpotTabId | null {
  if (tabs.length === 0) return null;
  const at = Math.max(
    0,
    tabs.findIndex((t) => t.id === current),
  );
  switch (key) {
    case 'ArrowRight':
      return tabs[(at + 1) % tabs.length].id;
    case 'ArrowLeft':
      return tabs[(at - 1 + tabs.length) % tabs.length].id;
    case 'Home':
      return tabs[0].id;
    case 'End':
      return tabs[tabs.length - 1].id;
    default:
      return null;
  }
}
