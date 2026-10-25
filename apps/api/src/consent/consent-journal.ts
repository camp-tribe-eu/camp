import type { EntityManager } from 'typeorm';
import { ConsentRecord } from '../entities/consent-record.entity';
import { wordingAt, type WordingKey } from './wordings';

export type ConsentEntry = {
  userId: string;
  /** Яке формулювання. */
  wording: WordingKey;
  /**
   * Яка його версія — та, під якою людина діяла. Береться з `checkOffer` або
   * `versionSeenOrCurrent`, ніколи не «чинна на момент запису» за замовчуванням.
   */
  version: number;
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
 * 🔴 ВИД І ДЖЕРЕЛО — З РЕЄСТРУ, НЕ ВІД ВИКЛИКАЧА, А ВЕРСІЯ — ЛИШЕ ТА, ЩО Є В
 * РЕЄСТРІ. Виклик називає ключ і номер версії; запис формулювання за цією
 * парою шукається в реєстрі, і якщо його немає — `throw`, рядок не пишеться.
 * Вид, джерело й версія в рядку — поля знайденого запису, тож ні браузер, ні
 * зайве поле в об'єкті не підмінять їх.
 *
 * 🔴 ПРИЙМАЄ `EntityManager`, А НЕ РЕПОЗИТОРІЙ: рядок мусить іти в тій самій
 * транзакції, що й зміна `users.marketing_consent_at`. Прапорець без рядка
 * (або рядок без прапорця) — це дві правди про одну згоду.
 */
export async function appendConsent(
  m: EntityManager,
  entry: ConsentEntry,
): Promise<void> {
  const w = wordingAt(entry.wording, entry.version);
  // 🔴 Рядок без формулювання нічого б не доводив — він не пишеться.
  if (!w)
    throw new Error(
      `no wording "${entry.wording}" version ${String(entry.version)} in the registry`,
    );
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
