import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type NewsletterStatus = 'pending' | 'confirmed' | 'unsubscribed';

/**
 * Одна адреса, що попросила листи від CampTribe (CAMP-441/7).
 *
 * 🔴 ЦЕ ENTITY ЛИШЕ ОПИСУЄ ТАБЛИЦЮ; код API пише в неї сирим SQL
 * (`newsletter.service.ts`), бо кожен перехід — один атомарний оператор
 * (`INSERT … ON CONFLICT`, `UPDATE … WHERE status = …`), а не «прочитав,
 * вирішив, записав». Таблиця НЕ зареєстрована в Directus (див. міграцію).
 *
 * 🔴 ТОКЕНІВ ТУТ НЕМАЄ — лише їхні хеші. Сирий токен існує в листі й нігде
 * більше.
 */
@Entity('newsletter_subscribers')
export class NewsletterSubscriber {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Завжди в нижньому регістрі — `CHECK` у базі. */
  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'text' })
  status: NewsletterStatus;

  @Column({ name: 'confirm_token_hash', type: 'text', nullable: true })
  confirmTokenHash: string | null;

  @Column({
    name: 'confirm_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  confirmTokenExpiresAt: Date | null;

  @Column({ name: 'unsubscribe_token_hash', type: 'text', nullable: true })
  unsubscribeTokenHash: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'unsubscribed_at', type: 'timestamptz', nullable: true })
  unsubscribedAt: Date | null;
}
