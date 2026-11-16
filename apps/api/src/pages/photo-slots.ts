/**
 * Слоти фото, які власник заповнює в Directus,.
 *
 * Рішення власника 16.11.2026: «заглушки фото де треба, а я виведу перед
 * відкриттям сайту вже те, що мені буде потрібно». Тема Fuse має фото там,
 * де наш сайт досі нічого не мав; фото ми не генеруємо й не беремо чужих
 * (на сайті надруковано «No stock photography and no AI-generated images
 * of places nobody has visited»), тому місце під фото — слот: порожній
 * показує заглушку, заповнений — зображення власника.
 *
 * 🔴 ЖОДНОЇ НОВОЇ КОЛЕКЦІЇ І ЖОДНОГО НОВОГО ПОЛЯ. Прод стоїть на 25 із 25.
 * Слот — це рядок `pages` з `type = 'photo-slot'` і слагом = ключ слота;
 * адреса й опис лежать у ВЖЕ ІСНУЮЧИХ `pages.banner_image_url` і
 * `page_translations.banner_image_alt` (той самий механізм, що в банера
 * країни, CAMP-469). Тому `directus_fields` на проді поповнювати НЕ треба.
 *
 * 🔴 ЦЕЙ ПЕРЕЛІК — ЄДИНЕ, ЩО API ВІДДАЄ ЯК СЛОТ. Ключ не з переліку — 404
 * до походу в базу. Веб тримає дзеркало (`apps/web/src/lib/photo-slot.ts`);
 * тест у вебі читає цей файл і червоніє, коли переліки розійшлися.
 */
export const PHOTO_SLOTS = [
  {
    key: 'route-hero',
    title: 'Route page — hero photo',
  },
  {
    key: 'guide-hero',
    title: 'Guide page — hero photo',
  },
  {
    key: 'guide-topic-hero',
    title: 'Guide topic page — hero photo',
  },
  {
    key: 'provider-hero',
    title: 'Rental provider page — hero photo',
  },
] as const;

export type PhotoSlotKey = (typeof PHOTO_SLOTS)[number]['key'];

export const isPhotoSlotKey = (v: string): v is PhotoSlotKey =>
  PHOTO_SLOTS.some((s) => s.key === v);
