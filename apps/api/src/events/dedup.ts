import { dedupHash, newSalt } from './events.rules';
import type { DedupParts } from './events.rules';

/**
 * CAMP-504. «Чи бачили ми цього відвідувача на цьому обʼєкті за цю подію
 * сьогодні?» — відповідь живе ТІЛЬКИ в памʼяті процесу.
 *
 * 🔴 НІКУДИ НЕ ПИШЕТЬСЯ: ні в базу, ні у файл, ні в лог. Зміна UTC-дня
 * очищає набір (дата входить у хеш, тож завтрашній хеш усе одно інший);
 * перезапуск процесу очищає його й міняє сіль. Ціна — чесна: після
 * перезапуску або на другому вузлі той самий відвідувач може бути
 * зарахований вдруге. Про це сказано на сторінці приватності.
 *
 * 🔴 ЗВЕРХУ ОБМЕЖЕНО: `MAX_DEDUP` хешів. Коли набір повний, нові події
 * зараховуються БЕЗ памʼяті про них — памʼять не росте, а подія не губиться.
 */
export const MAX_DEDUP = 200_000;

export class DailyDedup {
  private day = '';
  private seenToday = new Set<string>();
  private readonly salt = newSalt();

  constructor(private readonly max: number = MAX_DEDUP) {}

  /** `true` — цей відвідувач ВЖЕ зарахований сьогодні, подію не рахувати. */
  seen(parts: DedupParts): boolean {
    if (parts.day !== this.day) {
      this.day = parts.day;
      this.seenToday = new Set();
    }
    const hash = dedupHash(this.salt, parts);
    if (this.seenToday.has(hash)) return true;
    if (this.seenToday.size < this.max) this.seenToday.add(hash);
    return false;
  }

  /** Лише для тестів: скільки хешів зараз у памʼяті. */
  size(): number {
    return this.seenToday.size;
  }
}
