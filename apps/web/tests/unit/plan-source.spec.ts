import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import type { PlanOutcome, PlanRequest } from '@/lib/plan';
import { callPlan, readPlan } from '@/lib/plan-source';

// CAMP-391 — розмова сторінки з планувальником: що вона відправляє і як читає
// відповідь.
//
// 🔴 ВІДПОВІДІ ТУТ — СПРАВЖНІ, НЕ ПРИДУМАНІ. Файли в `tests/unit/fixtures/plan-*.json`
// зняті 25.10.2026 з `POST /plan` локального API над копією `camptribe_dev`
// (63 159 рядків у `camping_spots`), тими ж командами, що описані нижче, і
// лежать як `{ status, body }`: код відповіді й тіло, як їх віддав сервер.
// Відповідь, придумана руками, перевіряла б мою уяву про API, а не API. API
// звіряє цей самий файл зі своїм відображувачем у `plan-response.spec.ts`
// («ті самі ключі в обидва боки»), тож розбіжність між сторінкою й сервером
// червоніє з обох боків.
//
//   plan-ok            Lyon → Barcelona, 7 днів: шість ночівель у Франції й
//                      Іспанії, одна з них (Blue Bayou) зі зірками з
//                      DATAtourisme через зв'язок
//   plan-no-chain      Marseille → Ajaccio: відкрита вода
//   plan-round-trip    A = B
//   plan-outside-union London → Split: 400
//   plan-throttled     одинадцятий запит за хвилину: 429
//
// Що тест НЕ показує: що браузер доходить до API (CORS, CSP). Це перевірено
// руками в браузері й записано в описі PR: збірка CI не має
// `NEXT_PUBLIC_API_BASE_URL`, і `callPlan` там чесно каже «не відповів».

interface Captured {
  status: number;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const fixture = (name: string): Captured =>
  JSON.parse(readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));

const OK = fixture('plan-ok');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const planned = (r: PlanOutcome) => {
  if (r.status !== 'planned') throw new Error(`not planned: ${JSON.stringify(r)}`);
  return r.plan;
};

const REQUEST: PlanRequest = {
  from: { lat: 45.764, lon: 4.8357 },
  to: { lat: 41.3874, lon: 2.1686 },
  days: 7,
};

test.describe('🔴 справжні відповіді API читаються так, як сказано', () => {
  test('план: сім днів, шість ночівель, остання ніч — це кінець', () => {
    expect(OK.status).toBe(200);
    const plan = planned(readPlan(OK.status, OK.body));
    expect(plan.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plan.days.filter((d) => d.night)).toHaveLength(6);
    expect(plan.days[6].night).toBeNull();
    expect(plan.lengthM).toBe(OK.body.lengthM);
    expect(plan.candidates).toBe(OK.body.candidates);
  });

  test('метри в плані — ті, що дав сервер, і день за днем складаються в довжину', () => {
    const plan = planned(readPlan(OK.status, OK.body));
    expect(plan.days.map((d) => d.runM)).toEqual(OK.body.days.map((d: any) => d.runM)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(plan.days.reduce((a, d) => a + d.runM, 0)).toBeCloseTo(plan.lengthM, 3);
  });

  test('чим ранжується — з відповіді, і сума ваг — одиниця', () => {
    const plan = planned(readPlan(OK.status, OK.body));
    expect(plan.ranking.map((t) => t.id)).toEqual(['distance_fit', 'electricity', 'greyWater', 'stars']);
    expect(plan.ranking.reduce((a, t) => a + t.weight, 0)).toBeCloseTo(1, 10);
  });

  test('🔴 ночівля зі зірками з DATAtourisme несе джерело й ДАТУ його запису', () => {
    const plan = planned(readPlan(OK.status, OK.body));
    const night = plan.days.flatMap((d) => (d.night ? [d.night] : [])).find((n) => n.slug === 'blue-bayou')!;
    expect(night.stars).toBe(5);
    expect(night.sources).toEqual([
      { id: 'osm', updatedAt: '2026-10-16' },
      { id: 'datatourisme', updatedAt: '2026-09-07' },
    ]);
    expect(night.path).toBe('/camping/fr/herault/blue-bayou');
    expect(night.reasons.find((r) => r.field === 'stars')).toMatchObject({ value: 5, weighed: true });
  });

  test('кожна ночівля має назву, країну і сторінку цього сайту', () => {
    const plan = planned(readPlan(OK.status, OK.body));
    for (const d of plan.days) {
      if (!d.night) continue;
      expect(d.night.name, d.night.slug).toBeTruthy();
      expect(d.night.country).toMatch(/^[A-Z]{2}$/);
      expect(d.night.path, d.night.slug).toMatch(/^\/camping\//);
    }
  });

  test('записане — лише «yes» чи «no», і лише відомі зручності', () => {
    const plan = planned(readPlan(OK.status, OK.body));
    const seen = new Set(plan.days.flatMap((d) => (d.night ? Object.values(d.night.amenities) : [])));
    expect([...seen].sort()).toEqual(['no', 'yes']);
  });

  test('відмова «ланцюжка немає» — це відповідь планувальника, а не збій', () => {
    const c = fixture('plan-no-chain');
    expect(c.status).toBe(200);
    expect(readPlan(c.status, c.body)).toEqual({
      status: 'refused',
      reason: 'no-chain',
      lengthM: c.body.lengthM,
      daysAsked: 7,
      candidates: c.body.candidates,
      reachedNights: c.body.reachedNights,
    });
  });

  test('коло — теж відповідь', () => {
    const c = fixture('plan-round-trip');
    expect(readPlan(c.status, c.body)).toEqual({ status: 'refused', reason: 'round-trip' });
  });

  test('точка поза ЄС — `outside-union` з названим полем', () => {
    const c = fixture('plan-outside-union');
    expect(c.status).toBe(400);
    expect(readPlan(c.status, c.body)).toEqual({ status: 'outside-union', fields: ['from'] });
  });

  test('429 — ліміт, а не збій', () => {
    const c = fixture('plan-throttled');
    expect(c.status).toBe(429);
    expect(readPlan(c.status, c.body)).toEqual({ status: 'throttled' });
  });
});

test.describe('🔴 відповідь, що збрехала про форму, — це failed, а не напівплан', () => {
  const failed = (b: unknown, status = 200) => expect(readPlan(status, b)).toEqual({ status: 'failed' });
  const mutated = (edit: (b: Captured['body']) => void) => {
    const b = clone(OK.body);
    edit(b);
    return b;
  };

  test('`measure` не «straight»: сторінка не підпише шосе пряму лінію', () => {
    failed(mutated((b) => (b.measure = 'road')));
    failed(mutated((b) => (b.days[2].measure = 'road')));
    failed(mutated((b) => delete b.measure));
    failed(mutated((b) => delete b.days[0].measure));
  });

  test('день без номера чи не за порядком', () => {
    failed(mutated((b) => (b.days[3].day = 9)));
    failed(mutated((b) => b.days.splice(2, 1)));
    failed(mutated((b) => (b.days = [])));
    failed(mutated((b) => (b.days = 'seven')));
  });

  test('ночівля на місці кінця, і кінець на місці ночівлі', () => {
    failed(mutated((b) => (b.days[1].night = null)));
    failed(mutated((b) => (b.days[6].night = clone(b.days[0].night))));
  });

  test('зіпсована ночівля коштує відповіді: інакше день зник би з маршруту', () => {
    failed(mutated((b) => (b.days[0].night.country = 'FRA')));
    failed(mutated((b) => delete b.days[0].night.slug));
    failed(mutated((b) => (b.days[0].night.fromTargetM = 'near')));
    failed(mutated((b) => (b.days[0].night.alongM = null)));
  });

  test('ranking: порожній, без ваг, вага поза 0..1', () => {
    failed(mutated((b) => (b.ranking = [])));
    failed(mutated((b) => delete b.ranking));
    failed(mutated((b) => (b.ranking[0].weight = 1.5)));
    failed(mutated((b) => (b.ranking[0].weight = '0.75')));
    failed(mutated((b) => delete b.ranking[1].id));
  });

  test('довжина й кількість кандидатів', () => {
    failed(mutated((b) => (b.lengthM = -1)));
    failed(mutated((b) => (b.lengthM = 'long')));
    failed(mutated((b) => (b.candidates = 1.5)));
    failed(mutated((b) => (b.candidates = -3)));
  });

  test('і все, що не є тілом: нічого, сміття, чужий статус', () => {
    for (const body of [null, undefined, 0, 'ok', [], {}, { status: 'ok' }, { status: 'planned' }, { status: 'unsupported', reason: 'other' }]) {
      failed(body);
    }
    failed({ status: 'infeasible', reason: 'band', measure: 'straight', lengthM: 1, daysAsked: 2 });
    failed({ status: 'infeasible', reason: 'no-chain', measure: 'road', lengthM: 1, daysAsked: 2, candidates: 1, reachedNights: 0 });
    failed({ status: 'infeasible', reason: 'no-chain', measure: 'straight', lengthM: 1 });
  });

  test('статуси, яких ми не чекаємо, — failed; 429 — ліміт за будь-якого тіла', () => {
    for (const status of [201, 204, 301, 401, 404, 409, 413, 422, 500, 502, 503]) {
      failed(OK.body, status);
    }
    for (const body of [null, 'x', {}, { statusCode: 429 }]) {
      expect(readPlan(429, body)).toEqual({ status: 'throttled' });
    }
  });

  test('🔴 400: поза ЄС — лише коли ВСІ відмови про це; будь-яка інша — наша розбіжність', () => {
    const e = (field: string, code: string) => ({ field, code, message: 'x' });
    const body = (errors: unknown) => ({ code: 'invalid_plan_request', message: 'x', errors });
    expect(readPlan(400, body([e('to', 'outside_union')]))).toEqual({ status: 'outside-union', fields: ['to'] });
    expect(readPlan(400, body([e('from', 'outside_union'), e('to', 'outside_union')]))).toEqual({
      status: 'outside-union',
      fields: ['from', 'to'],
    });
    // Один і той самий дубль двічі — одне поле.
    expect(readPlan(400, body([e('to', 'outside_union'), e('to', 'outside_union')]))).toEqual({
      status: 'outside-union',
      fields: ['to'],
    });
    // Форма перевіряє все, крім межі ЄС. Інша відмова — розбіжність, і
    // казати про неї «ваша точка поза ЄС» було б брехнею.
    failed(body([e('days', 'days_out_of_range')]), 400);
    failed(body([e('from', 'outside_union'), e('days', 'days_out_of_range')]), 400);
    failed(body([e('body', 'unknown_field')]), 400);
    failed(body([e('days', 'outside_union')]), 400);
    failed(body([]), 400);
    failed(body('x'), 400);
    failed({ code: 'something_else', errors: [e('to', 'outside_union')] }, 400);
    failed(null, 400);
  });
});

test.describe('🔴 один зіпсований запис коштує одного запису', () => {
  const nightOf = (edit: (n: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const b = clone(OK.body);
    edit(b.days[0].night);
    return planned(readPlan(200, b)).days[0].night!;
  };

  test('адреса сторінки, що не наша, — ночівля лишається, без посилання', () => {
    for (const bad of [
      'javascript:alert(1)',
      'https://evil.example/camping/fr/x/y',
      '//evil.example/camping/fr/x/y',
      '/camping/fr/x/',
      '/camping/fr/x',
      '/camping/FR/x/y',
      '/map',
      '',
      null,
      7,
    ]) {
      const n = nightOf((x) => (x.path = bad));
      expect(n.path, String(bad)).toBeNull();
      expect(n.slug).toBeTruthy();
    }
    expect(nightOf((x) => (x.path = '/camping/fr/haute-loire/camp-2')).path).toBe('/camping/fr/haute-loire/camp-2');
  });

  test('назви немає чи вона з самих пробілів — це «без назви», а не порожній рядок', () => {
    for (const bad of [null, '', '   ', 7, undefined]) {
      expect(nightOf((x) => (x.name = bad)).name, String(bad)).toBeNull();
    }
  });

  test('причина без тексту, без поля чи з чужою одиницею випадає, решта — на місці', () => {
    const before = OK.body.days[0].night.reasons.length;
    expect(before).toBeGreaterThan(1);
    const n = nightOf((x) => {
      x.reasons.push(
        { field: 'electricity', value: 'yes', unit: null, weighed: true },
        { field: '', value: 'yes', unit: null, weighed: true, text: 'x' },
        { field: 'stars', value: 5, unit: 'furlongs', weighed: true, text: 'x' },
        { field: 'stars', value: {}, unit: null, weighed: true, text: 'x' },
        { field: 'stars', value: 5, unit: 'stars', weighed: 'yes', text: 'x' },
        { field: 'stars', value: 5, unit: 'stars', weighed: true, text: '   ' },
        null,
        'reason',
      );
    });
    expect(n.reasons).toHaveLength(before);
  });

  test('запис про джерело без id чи дати випадає', () => {
    const n = nightOf((x) => {
      x.sources.push({ id: 'osm' }, { updatedAt: '2026-01-01' }, { id: '', updatedAt: '2026-01-01' }, null, 'osm');
    });
    expect(n.sources).toEqual([{ id: 'osm', updatedAt: '2026-10-16' }]);
  });

  test('зручність, якої ми не знаємо, чи зі значенням «unknown»/«maybe», не читається', () => {
    const n = nightOf((x) => {
      x.amenities = { electricity: 'yes', water: 'no', wifi: 'unknown', shower: 'maybe', jacuzzi: 'yes', greyWater: 1 };
    });
    expect(n.amenities).toEqual({ electricity: 'yes', water: 'no' });
  });

  test('зірки поза шкалою 1–5 — «немає», а не 7 зірок', () => {
    for (const bad of [0, 6, 7, -1, '5', null, NaN]) {
      expect(nightOf((x) => (x.stars = bad)).stars, String(bad)).toBeNull();
    }
    expect(nightOf((x) => (x.stars = 3)).stars).toBe(3);
  });

  test('🔴 чужі ключі не доїжджають до сторінки, хоч би що API колись додав', () => {
    const b = clone(OK.body);
    b.driveMinutes = 600;
    b.days[0].drivingSeconds = 3600;
    b.days[0].night.roadDistanceM = 123;
    b.days[0].night.score = 0.9;
    b.days[0].night.reasons[0].hoursAtTheWheel = 1;
    const text = JSON.stringify(planned(readPlan(200, b)));
    for (const key of ['driveMinutes', 'drivingSeconds', 'roadDistanceM', 'score', 'hoursAtTheWheel']) {
      expect(text, key).not.toContain(key);
    }
  });
});

test.describe('callPlan — що іде в мережу', () => {
  type Seen = { url: string; init: RequestInit };
  const answering =
    (status: number, body: unknown, seen: Seen[] = []) =>
    async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return {
        status,
        json: async () => {
          if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
          return body;
        },
      } as unknown as Response;
    };

  test('🔴 POST на `${адреса}/plan`, JSON, і рівно три ключі', async () => {
    const seen: Seen[] = [];
    const out = await callPlan(REQUEST, 'https://api.example', answering(OK.status, OK.body, seen));
    expect(out.status).toBe('planned');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.example/plan');
    expect(seen[0].init.method).toBe('POST');
    expect((seen[0].init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(seen[0].init.body as string)).toEqual({
      from: { lat: 45.764, lon: 4.8357 },
      to: { lat: 41.3874, lon: 2.1686 },
      days: 7,
    });
  });

  test('🔴 координати йдуть числами, а не рядками: API відмовляє на текст', async () => {
    const seen: Seen[] = [];
    await callPlan(REQUEST, 'https://api.example', answering(200, {}, seen));
    const sent = JSON.parse(seen[0].init.body as string);
    for (const v of [sent.from.lat, sent.from.lon, sent.to.lat, sent.to.lon, sent.days]) {
      expect(typeof v).toBe('number');
    }
  });

  test('🔴 запит їде лише з трьох полів: поле, яке колись додадуть для сторінки, не їде на сервер', async () => {
    const seen: Seen[] = [];
    const dirty = { ...REQUEST, vehicleId: 'motorhome', extra: 1, from: { ...REQUEST.from, label: 'Lyon' } } as PlanRequest;
    await callPlan(dirty, 'https://api.example', answering(200, {}, seen));
    const sent = JSON.parse(seen[0].init.body as string);
    expect(Object.keys(sent).sort()).toEqual(['days', 'from', 'to']);
    expect(Object.keys(sent.from).sort()).toEqual(['lat', 'lon']);
  });

  test('🔴 порожня адреса API — failed, і до мережі не доходить нічого', async () => {
    const seen: Seen[] = [];
    expect(await callPlan(REQUEST, '', answering(200, OK.body, seen))).toEqual({ status: 'failed' });
    expect(seen).toEqual([]);
  });

  test('мережа впала — failed', async () => {
    const down = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await callPlan(REQUEST, 'https://api.example', down)).toEqual({ status: 'failed' });
  });

  test('відповідь не JSON: 200 — failed, 429 — усе одно ліміт, 500 — failed', async () => {
    expect(await callPlan(REQUEST, 'https://api.example', answering(200, undefined))).toEqual({ status: 'failed' });
    expect(await callPlan(REQUEST, 'https://api.example', answering(429, undefined))).toEqual({ status: 'throttled' });
    expect(await callPlan(REQUEST, 'https://api.example', answering(500, undefined))).toEqual({ status: 'failed' });
  });

  test('🔴 сервер мовчить — після межі це failed, а не вічне «Asking the planner…»', async () => {
    const silent = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const t0 = Date.now();
    expect(await callPlan(REQUEST, 'https://api.example', silent, 60)).toEqual({ status: 'failed' });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test('запит несе сигнал скасування: без нього межа часу нічого не значила б', async () => {
    const seen: Seen[] = [];
    await callPlan(REQUEST, 'https://api.example', answering(200, {}, seen));
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
  });
});
