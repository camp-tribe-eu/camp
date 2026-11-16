import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { ForecastService } from './forecast.service';

// CAMP-477. The service finds the campsite itself; nothing a caller sends
// but the slug reaches the database, and an unknown slug never reaches the
// bucket (this test has no network: a read would fail it with a 503, not 404).

describe('ForecastService', () => {
  it('an unknown slug is a 404, and the slug is a bound parameter', async () => {
    const seen: unknown[][] = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        seen.push([sql, params]);
        return [];
      },
    } as unknown as DataSource;
    await expect(
      new ForecastService(db).forecast('nowhere'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(seen).toHaveLength(1);
    expect(seen[0][1]).toEqual(['nowhere']);
    expect(String(seen[0][0])).not.toContain('nowhere');
  });
});
