import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * CAMP-504. Денний лічильник події над кемпінгом. Рядок = (день, кемпінг,
 * подія, клас джерела) + число. Див. міграцію `EventRollups`.
 *
 * 🔴 Колонок про людину НЕМАЄ: ані IP, ані хеша, ані агента, ані реферера.
 * Хеш дедуплікації живе лише в памʼяті (`events/dedup.ts`).
 */
@Entity('spot_event_daily')
export class SpotEventDaily {
  @PrimaryColumn({ type: 'date' })
  day: string;

  @PrimaryColumn({ name: 'camping_spot_id', type: 'uuid' })
  campingSpotId: string;

  @PrimaryColumn({ type: 'text' })
  event: string;

  @PrimaryColumn({ type: 'text' })
  source: string;

  @Column({ type: 'integer' })
  n: number;
}
