import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * CAMP-504. Пошуки, що не дали нічого: скільки разів за день, на якій
 * поверхні (`search` / `map`) і з якими фільтрами (канонічний рядок
 * `type:free,paid|amenity:shower|overnight`).
 *
 * 🔴 ТЕКСТУ ЗАПИТУ ТУТ НЕМАЄ І НЕ БУДЕ: людина може вписати в пошук імʼя.
 * Лише закритий перелік фільтрів, який API перевіряє (`events.rules.ts`).
 */
@Entity('zero_result_search_daily')
export class ZeroResultSearchDaily {
  @PrimaryColumn({ type: 'date' })
  day: string;

  @PrimaryColumn({ type: 'text' })
  surface: string;

  @PrimaryColumn({ type: 'text' })
  filters: string;

  @Column({ type: 'integer' })
  n: number;
}
