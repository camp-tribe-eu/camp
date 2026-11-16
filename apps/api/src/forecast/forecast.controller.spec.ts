import {
  type INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ForecastController } from './forecast.controller';
import { ForecastService } from './forecast.service';

// CAMP-477. The route over a real socket, the service behind it a stub.

let app: INestApplication;
let base = '';
let answer: () => Promise<unknown>;
const asked: unknown[] = [];

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    controllers: [ForecastController],
    providers: [
      {
        provide: ForecastService,
        useValue: {
          forecast: (q: unknown) => {
            asked.push(q);
            return answer();
          },
        },
      },
    ],
  }).compile();
  app = mod.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(() => app.close());
beforeEach(() => {
  asked.length = 0;
  answer = async () => ({ model: 'm', runAt: 'r', days: [] });
});

const get = (qs: string) => fetch(`${base}/forecast?${qs}`);

describe('GET /forecast', () => {
  it('an answer is cacheable for fifteen minutes and passes the parsed query on', async () => {
    const r = await get('lat=46.6&lng=-1.8&country=FR');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=900');
    expect(asked).toEqual([{ lat: 46.6, lon: -1.8, country: 'fr' }]);
  });

  it('a point outside the EU is a 400 with NO Cache-Control, and never reaches the service', async () => {
    const r = await get('lat=40.7&lng=-74&country=es');
    expect(r.status).toBe(400);
    expect(r.headers.get('cache-control')).toBeNull();
    expect(asked).toEqual([]);
  });

  it('no forecast is a 503 with NO Cache-Control: one bad second is not kept for a quarter of an hour', async () => {
    answer = async () => {
      throw new ServiceUnavailableException('forecast is not available');
    };
    const r = await get('lat=46.6&lng=-1.8&country=fr');
    expect(r.status).toBe(503);
    expect(r.headers.get('cache-control')).toBeNull();
  });
});
