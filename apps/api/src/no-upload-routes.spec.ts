import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// CAMP-388 — підстава, на якій multer лежить у scripts/security/known-advisories.json.
//
// 🔴 ЩО ЦЕ ТРИМАЄ. GHSA-q7qp-rjg7-q26m (multer, high) прийнято НЕ тому, що
// «ми вважаємо це безпечним», а тому, що multer у нас ніколи не стоїть
// перед запитом: Nest підключає його лише через ці імена
// (FileInterceptor, FilesInterceptor, AnyFilesInterceptor,
// FileFieldsInterceptor, NoFilesInterceptor, MulterModule), а вразливість
// потребує `fileFilter` на живому завантаженні. Заміряно 25.10.2026: жодного
// з цих імен у `apps/api/src` немає, а всі 15 маршрутів із тілом (@Post)
// приймають JSON.
//
// Прийняття, у якому підстава може стати хибною мовчки, — це прийняття, яке
// перестає бути чесним у день, коли хтось додає завантаження фото
// (CAMP-86). Цей спек і є «мовчки» → «голосно»: він червоніє в той самий
// день і каже, що робити.
//
// 🔴 ЦІНА ХИБНОГО СПРАЦЮВАННЯ — одне перейменоване слово в коментарі або
// один запис у базі. Тому сканується ПЛОСКИЙ текст без вирізання
// коментарів: вирізання коментарів і рядків — це окремий розбір, у якому
// помилка дає протилежний дефект (сторож сліпне там, де шукає). Червоне
// через слово в коментарі лікується за хвилину; сліпий сторож не лікується
// ніким, бо ніхто не бачить, що він сліпий.
//
// Спек сам не сканується (він `.spec.ts`, а скануються лише виробничі
// файли): маршрут монтується контролером, а не тестом.

/** Імена, якими multer потрапляє перед запит. Кожне — з причиною. */
const UPLOAD_MARKERS: ReadonlyArray<{ name: string; re: RegExp }> = [
  // Інтерсептори Nest: єдиний штатний спосіб поставити multer перед маршрутом.
  {
    name: 'інтерсептор завантаження',
    re: /\b(?:File|Files|AnyFiles|FileFields|NoFiles)Interceptor\b/,
  },
  { name: 'MulterModule', re: /\bMulterModule\b/ },
  // Декоратори, які мають сенс лише після завантаження.
  { name: '@UploadedFile(s)', re: /\bUploadedFiles?\b/ },
  // Ручне підключення, повз Nest: `app.use(multer().any())`.
  { name: "імпорт 'multer'", re: /['"]multer['"]/ },
  {
    name: 'шлях @nestjs/platform-express/multer',
    re: /platform-express\/multer/,
  },
  // Сам фільтр, на якому спрацьовує вразливість, і тип файлу від multer.
  { name: 'fileFilter', re: /\bfileFilter\b/ },
  { name: 'Express.Multer', re: /\bExpress\.Multer\b/ },
];

function uploadMarkersIn(source: string): string[] {
  return UPLOAD_MARKERS.filter(({ re }) => re.test(source)).map((m) => m.name);
}

/** Виробничі `.ts`-файли під `dir`, відносні шляхи з `/`. Не `.spec.ts`. */
function productionSources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts')
      ) {
        out.push(relative(dir, full).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return out.sort();
}

describe('the detector sees what it says it sees', () => {
  // 🔴 Позитиви. Без них «жодного збігу» нічого не доводить: регулярка, яка
  // не вміє знайти навіть явний імпорт, дає такий самий порожній звіт.
  it.each([
    [
      "import { FileInterceptor } from '@nestjs/platform-express';",
      'інтерсептор завантаження',
    ],
    [
      "@UseInterceptors(FilesInterceptor('photos', 5))",
      'інтерсептор завантаження',
    ],
    ['@UseInterceptors(AnyFilesInterceptor())', 'інтерсептор завантаження'],
    [
      "@UseInterceptors(FileFieldsInterceptor([{ name: 'a' }]))",
      'інтерсептор завантаження',
    ],
    ['@UseInterceptors(NoFilesInterceptor())', 'інтерсептор завантаження'],
    ['imports: [MulterModule.register({ dest: "/tmp" })]', 'MulterModule'],
    ['upload(@UploadedFile() file: unknown) {}', '@UploadedFile(s)'],
    ['upload(@UploadedFiles() files: unknown[]) {}', '@UploadedFile(s)'],
    ["import multer from 'multer';", "імпорт 'multer'"],
    ['const multer = require("multer");', "імпорт 'multer'"],
    [
      "import { diskStorage } from '@nestjs/platform-express/multer';",
      'шлях @nestjs/platform-express/multer',
    ],
    ['multer({ fileFilter: (req, file, cb) => cb(null, true) })', 'fileFilter'],
    ['photo: Express.Multer.File', 'Express.Multer'],
  ])('%j is found as «%s»', (source, name) => {
    expect(uploadMarkersIn(source)).toContain(name);
  });

  // Негативи фіксують межу хибного спрацьовування, а не «щоб було».
  it.each([
    // Той самий корінь слова, інша річ: лист із вкладеннями, не завантаження.
    "throw new Error('not a multipart message');",
    // Звичайний маршрут із тілом.
    "@Post('signup') signup(@Body() dto: SignupDto) {}",
    // Слово без лапок і без імені інтерсептора — це коментар про advisory.
    '// multer приймається в known-advisories.json, поки немає завантажень',
    // Інтерсептор, який не про файли.
    '@UseInterceptors(LoggingInterceptor)',
  ])('%j is not a finding', (source) => {
    expect(uploadMarkersIn(source)).toEqual([]);
  });
});

describe('the API has no upload handler, so multer is never in front of a request', () => {
  const root = __dirname;
  const files = productionSources(root);
  const read = (f: string) => readFileSync(join(root, f), 'utf8');

  // 🔴 Канарка проти сліпого сканування: прохід по порожньому списку дає
  // «0 збігів» так само, як прохід по справжньому коду. Сканування мусить
  // справді дійти до контролерів, на які ця підстава спирається.
  it('reads the controllers that take a request body', () => {
    const withBody = files.filter((f) => /@(?:Post|Put|Patch)\(/.test(read(f)));
    expect(withBody).toEqual(
      expect.arrayContaining([
        'auth/auth.controller.ts',
        'auth/account-settings.controller.ts',
        'telemetry/client-errors.controller.ts',
      ]),
    );
  });

  it('reads the entry point and the module that wires everything', () => {
    expect(files).toEqual(expect.arrayContaining(['main.ts', 'app.module.ts']));
  });

  it('finds none of the names that put multer in front of a route', () => {
    const hits = files.flatMap((f) =>
      uploadMarkersIn(read(f)).map((name) => `${f}: ${name}`),
    );
    if (hits.length > 0) {
      throw new Error(
        'У API з’явилося завантаження файлів:\n  ' +
          hits.join('\n  ') +
          '\n\nНа цьому тримається прийняття multer GHSA-q7qp-rjg7-q26m у ' +
          'scripts/security/known-advisories.json («multer ніколи не стоїть ' +
          'перед запитом»). Воно більше не правдиве: або підніміть multer ' +
          'до ≥2.5.0 (`npm view @nestjs/platform-express dependencies.multer` ' +
          'покаже, чи вже можна), або перепишіть причину й дату перегляду.',
      );
    }
    expect(hits).toEqual([]);
  });
});
