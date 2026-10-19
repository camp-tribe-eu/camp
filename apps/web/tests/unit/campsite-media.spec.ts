import { expect, test } from '@playwright/test';
import { choosePhoto, type Photo } from '@/components/campsite-media';

/**
 * CAMP-344 — порядок пріоритету медіаслота.
 *
 * Рішення власника 18.10.2026: фото власника найвище, фото користувачів
 * середнє, мапа коли немає нічиїх.
 *
 * 🔴 КАРТКА ВИМАГАЄ ДОВЕСТИ ЦЕ ТРЬОМА СТОРІНКАМИ, І ЦЬОГО ЗРОБИТИ ЗАРАЗ
 * НЕ МОЖНА. Сторінок із фото сьогодні нуль: канал власника
 * (CAMP-233/232) і реєстр прав (CAMP-342) ще не зроблені. На живих
 * сторінках перевіряється рівно один рівень із трьох — мапа.
 *
 * Решту двох перевіряє цей файл. Коли фото зʼявляться, порядок уже буде
 * під сторожем, а не під обіцянкою — і якщо хтось тоді поверне
 * `photos[0]` замість `find`, це впаде тут, а не на сторінці живого
 * кемпінгу.
 */

const photo = (source: Photo['source'], credit: string): Photo => ({
  url: `https://example.invalid/${source}.jpg`,
  source,
  credit,
  width: 1200,
  height: 800,
});

test('фото власника виграє в користувацького', () => {
  const owner = photo('owner', 'Photo: the site owner, June 2026');
  const user = photo('user', 'Photo: a visitor, July 2026');
  // 🔴 Користувацьке стоїть ПЕРШИМ у масиві — саме так помилка й
  // виглядала б, якби слот брав `photos[0]`.
  expect(choosePhoto([user, owner])?.source).toBe('owner');
  expect(choosePhoto([owner, user])?.source).toBe('owner');
});

test('де є лише користувацьке — показано його', () => {
  const user = photo('user', 'Photo: a visitor, July 2026');
  expect(choosePhoto([user])?.source).toBe('user');
  expect(choosePhoto([user])?.credit).toBe('Photo: a visitor, July 2026');
});

test('де немає жодного — не показано нічого, і це означає мапу', () => {
  expect(choosePhoto([])).toBeNull();
});

test('🔴 кілька фото власника — береться перше, а не останнє', () => {
  // Пара до першого випадку: `find` повертає перше збіжне. Якби хтось
  // замінив його на `findLast` чи на сортування, обидва попередні тести
  // лишились би зеленими.
  const a = photo('owner', 'Photo: the site owner, May 2026');
  const b = photo('owner', 'Photo: the site owner, June 2026');
  expect(choosePhoto([a, b])?.credit).toBe('Photo: the site owner, May 2026');
});
