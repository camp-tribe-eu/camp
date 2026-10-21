/**
 * Брендові рядки голови документа — в одному місці.
 *
 * 🔴 Вони були написані ТРИЧІ в `layout.tsx` (типовий заголовок,
 * `openGraph`, `twitter`), і це стало дефектом, щойно головна дістала
 * право перевизначати заголовок із CMS: сторінка поставила свій
 * `<title>`, а `og:title` лишився брендовим — тобто документ
 * суперечив власній картці для соцмереж. Заміряно рецензією #306.
 *
 * Тепер перевизначення теж іде в усі три місця, і взяти їх нема звідки,
 * крім цього файла.
 */
export const BRAND_TITLE = "CampTribe — Plan Better. Camp Smarter.";

export const BRAND_DESCRIPTION =
  "Find campsites, plan routes and book camper rentals across Europe in one place.";
