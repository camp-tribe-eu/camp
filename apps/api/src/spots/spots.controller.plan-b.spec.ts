import { Logger } from '@nestjs/common';
import { SpotsController } from './spots.controller';
import type { SpotsService } from './spots.service';
import type { MapQueryService } from './map.service';

/**
 * CAMP-524: «План Б» — додатковий блок. Його збій коштує блоку, а не
 * сторінки: web на будь-який не-ok від API віддає 404 кемпінгу.
 */
const spot = { slug: 'camping-test', name: 'Camping Test' };

const make = (planB: () => Promise<unknown>) => {
  const spots = {
    findBySlug: async () => spot,
    nearby: async () => [{ slug: 'n' }],
    planB,
  } as unknown as SpotsService;
  return new SpotsController(spots, {} as MapQueryService);
};

describe('GET /spots/:country/:region/:slug: збій Плану Б', () => {
  it('віддає кемпінг із planB = null і пише warn зі slug', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const ctl = make(async () => {
      throw new Error('boom');
    });
    const res = await ctl.one('fr', 'x', 'camping-test');
    expect(res.spot).toBe(spot);
    expect(res.nearby).toEqual([{ slug: 'n' }]);
    expect(res.planB).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('camping-test');
    expect(String(warn.mock.calls[0][0])).toContain('boom');
    warn.mockRestore();
  });

  it('справний План Б проходить як є, без warn', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const view = { ranking: 'r', radiusM: 15000, items: [] };
    const res = await make(async () => view).one('fr', 'x', 'camping-test');
    expect(res.planB).toBe(view);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
