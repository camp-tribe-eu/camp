// Міст між тестом маршруту й рішенням панелі — щоб перший міг питати
// про НАСЛІДОК, а не лише про форму.
import { panelStateFor } from '@/components/warnings-for-spot';
import type { WarningFeed, WarningState } from '@/lib/warnings';

export { AGGREGATOR, METEOALARM_URL } from '@/lib/warnings';

export const panelStateForTestOnly = (
  country: string,
  codes: string[] | null,
  feed: WarningFeed | null,
  now: Date,
): WarningState | null => panelStateFor({ country, codes, feed, failed: false, now });
