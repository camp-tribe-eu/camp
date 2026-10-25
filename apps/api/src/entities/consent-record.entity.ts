import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ConsentKind, ConsentSource } from '../consent/wordings';
import { User } from './user.entity';

/**
 * Один рядок журналу згод. CAMP-390, ст. 7(1) GDPR.
 *
 * 🔴 РЯДОК ДОДАЄТЬСЯ, І НІКОЛИ НЕ ПЕРЕПИСУЄТЬСЯ. Відкликання згоди — це НОВИЙ
 * рядок із `granted = false`, а не `UPDATE` старого: інакше історія («погодився
 * на це тоді-то, відкликав тоді-то») зникає разом зі зміною, і довести нема чого.
 * Код пише лише `INSERT` (`appendConsent`), а база додатково відмовляє на
 * `UPDATE` тригером `consent_record_append_only` — тож і чужий скрипт, і
 * помилка в наступній правці впираються не в звичку, а в стіну.
 *
 * 🔴 ТЕКСТУ ТУТ НЕМАЄ — Є ПОСИЛАННЯ НА НЬОГО: (`wordingKey`, `wordingVersion`)
 * вказує на запис реєстру `consent/wordings.ts`, де версії лише дописуються.
 * Те, що людина бачила, дістається звідти, а не береться з браузера.
 *
 * Поточний стан людини — рядок із найбільшим `id` для її (`userId`, `kind`).
 * `id` — послідовність, а не `uuid`, саме щоб два рядки з однаковою позначкою
 * часу мали однозначний порядок. Жодне поле цієї таблиці не віддається на
 * вебсторінку: `id` не покидає базу, а решту отримує вивантаження ст. 15.
 *
 * `ON DELETE CASCADE`: журнал іде разом з акаунтом, коли його стирає
 * `purge`. Чи тримати доказ згоди довше за акаунт (позовна давність) — рішення
 * власника й політики приватності (CAMP-324), і воно тут НЕ ухвалене.
 */
@Entity('consent_record')
@Index('idx_consent_record_user', ['userId', 'recordedAt', 'id'])
export class ConsentRecord {
  /** `bigint` повертається драйвером рядком. */
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  kind: ConsentKind;

  /** `true` — надано; `false` — відкликано. Обидва — окремі рядки. */
  @Column({ type: 'boolean' })
  granted: boolean;

  @Column({ name: 'wording_key', type: 'text' })
  wordingKey: string;

  @Column({ name: 'wording_version', type: 'integer' })
  wordingVersion: number;

  @Column({ type: 'text' })
  source: ConsentSource;

  /**
   * Коли людина це зробила. Той самий момент, що в `users.marketing_consent_at`
   * для розсилки: прапорець і журнал пишуться в одній транзакції з одним `now`.
   */
  @Column({
    name: 'recorded_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  recordedAt: Date;
}
