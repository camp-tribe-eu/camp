import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isUnpublishedCountry,
  publishedCountrySql,
  UNPUBLISHED_COUNTRIES,
} from './unpublished-countries';

// CAMP-490. Це перелік «тримаємо, але не показуємо». Він НЕ є переліком
// області проєкту, і ця пара тверджень — те, що не дає їх склеїти.
describe('unpublished countries', () => {
  it('Кіпр прихований рішенням власника 11.11.2026', () => {
    expect(UNPUBLISHED_COUNTRIES).toContain('cy');
  });

  it('Åland не прихований: рішення по ньому ще не ухвалено', () => {
    expect(UNPUBLISHED_COUNTRIES).not.toContain('ax');
  });

  it('Кіпр лишається в переліку області: «не показуємо» не значить «стерти»', () => {
    // drop-non-eu.mjs видаляє з бази все, чого немає в цьому файлі.
    const scope = JSON.parse(
      readFileSync(
        join(__dirname, '..', 'osm', 'eu-member-states.json'),
        'utf8',
      ),
    ) as { members: Record<string, string> };
    const codes = Object.keys(scope.members).map((c) => c.toLowerCase());
    expect(codes.length).toBe(27);
    expect(codes).toContain('cy');
  });

  it('фрагмент WHERE відкидає кожен код переліку, незалежно від регістру', () => {
    const sql = publishedCountrySql('s');
    expect(sql).toBe("lower(s.country) NOT IN ('cy')");
    expect(isUnpublishedCountry('CY')).toBe(true);
    expect(isUnpublishedCountry('cy')).toBe(true);
    expect(isUnpublishedCountry('gr')).toBe(false);
    expect(isUnpublishedCountry(null)).toBe(false);
  });

  it('псевдонім підставляється як є', () => {
    expect(publishedCountrySql('camping_spots')).toContain(
      'lower(camping_spots.country)',
    );
  });
});
