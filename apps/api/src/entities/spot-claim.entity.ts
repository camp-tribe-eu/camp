import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CampingSpot } from './camping-spot.entity';
import { User } from './user.entity';

/**
 * Заявка на володіння кемпінгом. CAMP-51.
 *
 * 🔴 ЦЕ ГРАНТ, А НЕ ДРУГИЙ ТИП КОРИСТУВАЧА. Підтверджений власник — це
 * звичайний акаунт плюс рядок тут із `usedAt IS NOT NULL`. Той самий
 * урок, що записаний в `auth/ownership.ts`: «roles are a grant over an
 * ordinary account, not a second kind of user».
 *
 * Підтверджений рядок на кемпінг може бути лише один, і це тримає
 * частковий унікальний індекс, а не перевірка в коді: між SELECT і
 * UPDATE встигає другий запит.
 */
@Entity('spot_claims')
export class SpotClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CampingSpot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'camping_spot_id' })
  spot: CampingSpot;

  @Index()
  @Column({ name: 'camping_spot_id' })
  campingSpotId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  /**
   * 🔴 ХЕШ, НІКОЛИ КОД — те саме правило, що й для `auth_tokens` і
   * `sessions`: дамп цієї таблиці не має бути набором готових «забрати
   * чужий кемпінг».
   */
  @Column({ name: 'code_hash', length: 64 })
  codeHash: string;

  /**
   * `i***@c***.de`, і база на цьому наполягає (`spot_claims_masked_is_masked`).
   *
   * Адреса вже лежить у `camping_spots.contact`; другої копії тут не
   * треба, а маски досить, щоб людина впізнала, куди пішов лист.
   */
  @Column({ name: 'sent_to_masked', length: 255 })
  sentToMasked: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /**
   * Коли код увели. `NULL` — заявка в дорозі; не `NULL` — це і є грант.
   * Забирається через `UPDATE … WHERE used_at IS NULL`, тож два запити
   * на один код не можуть виграти обидва.
   */
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  /** Скільки разів помилились кодом. На `MAX_ATTEMPTS` заявка згорає. */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
