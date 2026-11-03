import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { API_SRC, readCode } from './legal-claims';
import { withOwnerOverrides } from '@/lib/api';

/**
 * CAMP-51 / CAMP-86 — те, що власник може ЗАПИСАТИ, мусить дорівнювати
 * тому, що сторінка ЧИТАЄ.
 *
 * 🔴 ЧОМУ ЦЕ ОКРЕМИЙ ТЕСТ, А НЕ РЯДОК У ЧУЖОМУ. Розійтись ці два списки
 * можуть мовчки й у будь-який бік, і обидва боки гнилі по-своєму:
 *
 *  * дозволили записати більше, ніж читаємо → власник править поле,
 *    якого сторінка не показує. Він виправить, побачить, що нічого не
 *    змінилось, і вирішить, що помилився сам. Про таке не пишуть у
 *    підтримку — про таке йдуть геть;
 *  * читаємо більше, ніж дозволяємо записати → у колонці лежить поле,
 *    яке ніхто не міг туди покласти через наш інтерфейс. Тобто або
 *    мертвий код, або шлях запису повз перевірку.
 *
 * Тому тест читає ОБИДВА файли як текст, а не вірить жодному переліку.
 */

const API_FILE = join(API_SRC, 'spots', 'owner-overrides.ts');
const WEB_FILE = join(process.cwd(), 'src', 'lib', 'api.ts');

/** `WRITABLE = Object.freeze(['name', 'amenities'] as const)` → імена. */
function writableInApi(): string[] {
  const code = readCode(API_FILE);
  const block = /WRITABLE\s*=\s*Object\.freeze\(\[([^\]]*)\]/.exec(code);
  if (!block) throw new Error('не знайдено WRITABLE в owner-overrides.ts');
  return [...block[1].matchAll(/['"]([a-zA-Z]+)['"]/g)].map((m) => m[1]).sort();
}

/** Поля, які `withOwnerOverrides` справді бере з об'єкта правок. */
function readInWeb(): string[] {
  const code = readCode(WEB_FILE);
  const start = code.indexOf('export function withOwnerOverrides');
  if (start < 0) throw new Error('не знайдено withOwnerOverrides в lib/api.ts');
  const body = code.slice(start, code.indexOf('\n}', start));
  const names = new Set(
    [...body.matchAll(/\bo\.([a-zA-Z]+)/g)].map((m) => m[1]),
  );
  return [...names].sort();
}

test.describe('межа власника: записуване = читане', () => {
  test('🔴 обидва боки називають ті самі поля', () => {
    const write = writableInApi();
    const read = readInWeb();
    // Якір: розбір справді щось знайшов — інакше дві порожні множини
    // «збігаються» і тест зелений над нічим.
    expect(write.length, 'WRITABLE не розібрано').toBeGreaterThan(0);
    expect(read.length, 'withOwnerOverrides не розібрано').toBeGreaterThan(0);
    expect(write).toEqual(read);
  });

  test('і це саме name та amenities', () => {
    expect(writableInApi()).toEqual(['amenities', 'name']);
  });

  test('🔴 правка справді доходить до сторінки, а не лише до колонки', () => {
    // Те саме, але на ПОВЕДІНЦІ: перелік може збігатись, а злиття —
    // мовчки не застосовувати поле.
    const base = {
      name: 'OSM name',
      amenities: { shower: 'no', wifi: 'unknown' },
      ownerOverrides: {},
    } as unknown as Parameters<typeof withOwnerOverrides>[0];

    const edited = withOwnerOverrides({
      ...base,
      ownerOverrides: { name: 'Owner name', amenities: { shower: 'yes' } },
    } as typeof base);

    expect(edited.name).toBe('Owner name');
    expect(edited.amenities.shower).toBe('yes');
    // І не зачіпає того, чого власник не правив.
    expect(edited.amenities.wifi).toBe('unknown');
  });

  test('порожні правки нічого не міняють', () => {
    const spot = {
      name: 'OSM name',
      amenities: { shower: 'no' },
      ownerOverrides: {},
    } as unknown as Parameters<typeof withOwnerOverrides>[0];
    expect(withOwnerOverrides(spot)).toBe(spot);
  });
});
