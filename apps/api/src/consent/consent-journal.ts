import type { EntityManager } from 'typeorm';
import { ConsentRecord } from '../entities/consent-record.entity';
import { currentWording, type WordingKey } from './wordings';

export type ConsentEntry = {
  userId: string;
  /** Яке формулювання людина бачила. Єдине, що вирішує інше. */
  wording: WordingKey;
  /** `true` — надала, `false` — відкликала. */
  granted: boolean;
  /** Той самий момент, що пишеться в прапорець `users`. */
  now: Date;
};

/**
 * Дописати рядок журналу згод (CAMP-390).
 *
 * 🔴 ТІЛЬКИ `INSERT`. Не `save` (він за наявного `id` перетворився б на
 * `UPDATE`), не `upsert`, не `update`: відкликання — новий рядок, і старий
 * лишається. База додатково відмовляє на `UPDATE` (`consent_record_append_only`).
 *
 * 🔴 ВИД, ВЕРСІЯ Й ДЖЕРЕЛО — З РЕЄСТРУ, НЕ ВІД ВИКЛИКАЧА. Виклик приймає ключ
 * формулювання й більше нічого про те, що саме було показано, тож ні браузер,
 * ні забутий аргумент не запишуть версії, якої людина не бачила. Версія — та,
 * що діє зараз (`currentWording`).
 *
 * 🔴 ПРИЙМАЄ `EntityManager`, А НЕ РЕПОЗИТОРІЙ: рядок мусить іти в тій самій
 * транзакції, що й зміна `users.marketing_consent_at`. Прапорець без рядка
 * (або рядок без прапорця) — це дві правди про одну згоду.
 */
export async function appendConsent(
  m: EntityManager,
  entry: ConsentEntry,
): Promise<void> {
  const w = currentWording(entry.wording);
  await m.insert(ConsentRecord, {
    userId: entry.userId,
    kind: w.kind,
    granted: entry.granted,
    wordingKey: w.key,
    wordingVersion: w.version,
    source: w.source,
    recordedAt: entry.now,
  });
}
