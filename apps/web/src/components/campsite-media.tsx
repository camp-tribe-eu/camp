import SiteMapEmbed from './site-map-embed';

/**
 * Медіаслот сторінки кемпінгу (CAMP-344).
 *
 * Пріоритет — рішення власника 18.10.2026, і порядок саме такий:
 *
 *   1. фото ВЛАСНИКА кемпінгу
 *   2. фото КОРИСТУВАЧІВ
 *   3. МАПА — коли немає нічиїх
 *
 * 🔴 Мапа тут не «бо порожньо». Макет `Design/01-campsite.html` каже
 * дослівно: «We don't publish pictures we haven't verified. No stock
 * shots, no AI-generated scenery». Тобто показати чуже фото гірше, ніж
 * показати мапу, і третій рівень — повноцінний стан, а не заглушка.
 *
 * 🔴 І ПРО ПІДПИС ПІД МАПОЮ — ТУТ Я РОЗІЙШОВСЯ З МАКЕТОМ, І ОСЬ ЧОМУ.
 * Макет підписує мапу «the real site outline from OpenStreetMap — the
 * shape of the ground». Заміряно 19.10.2026 по всіх 63 159 кемпінгах:
 *
 *   area / way — контур Є        34 750   55,1%
 *   node — контуру НЕМА          19 657   31,1%
 *   без osm_ref                   8 752   13,9%
 *
 * Для 45% сторінок обрису не існує в першоджерелі: в OSM це крапка.
 * Обіцяти там «контур ділянки» означало б написати неправду рівно на
 * тій сторінці, яка пояснює, чому ми не показуємо чужих фото. Тож
 * підпис каже те, що видно: місце і його околиці.
 *
 * Самого контуру поки немає й у базі — `camping_spots.location` це
 * `geometry(POINT, 4326)`. Довезти його можна (кожен рядок має
 * `osm_ref`), але це окрема робота: колонка, зміна імпорту й перерахунок
 * 63 159 рядків.
 */

export type Photo = {
  url: string;
  /** Хто зняв: саме це вирішує рівень пріоритету, а не здогад. */
  source: 'owner' | 'user';
  /** Підпис мусить називати походження — CAMP-233. */
  credit: string;
  width: number;
  height: number;
};

/**
 * Що показати: фото власника, інакше користувача, інакше нічого (мапа).
 *
 * 🔴 ВИНЕСЕНО В ЧИСТУ ФУНКЦІЮ НЕ ЗАРАДИ ЧИСТОТИ. Картка вимагає довести
 * порядок пріоритету ТРЬОМА сторінками — де є обидва фото, де лише
 * користувацьке, де немає жодного. Сторінок із фото сьогодні нуль:
 * канал власника (CAMP-233/232) і реєстр прав (CAMP-342) ще не
 * зроблені. Отже на живих сторінках довести можна рівно один рівень із
 * трьох.
 *
 * Функція дає решту двох: три випадки прогоняються в тесті, а не
 * чекають на дані, яких не буде ще довго. Коли фото зʼявляться, той
 * самий порядок уже буде під сторожем.
 *
 * 🔴 `find`, а не `photos[0]`. Порядок у масиві задає той, хто його
 * склав; пріоритет — рішення власника 18.10.2026. Якщо API колись
 * поверне користувацьке фото першим, слот не має мовчки показати його
 * замість власникового.
 */
export function choosePhoto(photos: readonly Photo[]): Photo | null {
  return (
    photos.find((p) => p.source === 'owner') ??
    photos.find((p) => p.source === 'user') ??
    null
  );
}

export function CampsiteMedia({
  photos,
  lat,
  lon,
  type,
  label,
}: {
  photos: readonly Photo[];
  lat: number;
  lon: number;
  type: string;
  label: string;
}) {
  const chosen = choosePhoto(photos);

  if (chosen) {
    return (
      <figure data-testid="campsite-media" data-kind={chosen.source}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={chosen.url}
          alt={label}
          width={chosen.width}
          height={chosen.height}
          className="aspect-[4/3] w-full rounded-card object-cover"
        />
        <figcaption className="mt-2 text-xs text-ink-2">{chosen.credit}</figcaption>
      </figure>
    );
  }

  return (
    <figure data-testid="campsite-media" data-kind="map">
      {/* 🔴 СПІВВІДНОШЕННЯ, А НЕ `h-full`. Перша редакція ставила мапі
          `h-full` всередині `flex-1`, а клітинка сітки власної висоти не
          має — тож `100%` від нічого дало РІВНО НУЛЬ. Канвас існував,
          помилок не було, і виглядало це як порожня рамка: той самий
          клас дефекту, що лишає тест зеленим над порожнечею.

          4:3 тримає мапу читабельною і на телефоні не зʼїдає перший
          екран: на 375 px це 281 px, тобто третина від 812. */}
      <div className="aspect-[4/3] min-h-[260px] w-full overflow-hidden rounded-card border border-line-2">
        <SiteMapEmbed lat={lat} lon={lon} type={type} label={label} />
      </div>
      <figcaption className="mt-2 text-xs text-ink-2">
        {/* 🔴 Два речення, і друге — причина. Без нього мапа читається як
            «фото не завантажилось». */}
        No verified photographs of this site yet. This is where it is —{' '}
        <span className="whitespace-nowrap">OpenFreeMap © OpenMapTiles</span>, data
        from OpenStreetMap.
      </figcaption>
    </figure>
  );
}
