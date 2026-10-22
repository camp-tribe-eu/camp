#!/usr/bin/env node
// CAMP-306: те, що на машині, мусить збігатися з тим, що в git.
//
//   node scripts/ci/check-server-drift.mjs --offline   # у CI, без SSH
//   node scripts/ci/check-server-drift.mjs             # по SSH, із ключем
//   node scripts/ci/check-server-drift.mjs --self-test
//
// 🔴 ЗВІДКИ ЦЕ ВЗЯЛОСЬ. 13.10.2026 `camptribe-backup.service` упав о
// 03:30 UTC: `WorkingDirectory=/srv/camptribe/app` — тека, яку прибрав
// деплой, що прокрутив релізи. Два інші юніти дивились у
// `/srv/camptribe/current`, бекап лишився на старій розкладці. Добу
// жили без бекапу й не знали; знайшлось випадково.
//
// Виправив я це текстовим редактором НА МАШИНІ — тобто зміни не було
// ні в репозиторії, ні в рецензії, ні в історії. Наступний дрейф
// знайшовся б так само випадково.
//
// 🔴 ДВА РЕЖИМИ, І ЇХНІ МЕЖІ СКАЗАНО ПРЯМО.
//
// `--offline` біжить у CI й питає те, на що вистачає репозиторію: чи
// посилається юніт на щось, чого в репозиторії немає. Саме цей клас
// убив бекап — рядок, що вказує в порожнечу.
//
// Без прапорця потрібен SSH-ключ, тож у CI воно НЕ біжить і вдавати
// протилежне було б гірше за відсутність перевірки. Це інструмент для
// машини, де ключ є.

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const INFRA = path.join(ROOT, 'infra');

/** Куди лягає кожен файл репозиторію на машині. */
export const DESTINATION = Object.freeze({
  systemd: '/etc/systemd/system',
  bin: '/usr/local/bin',
  // 🔴 ЦЬОГО РЯДКА НЕ БУЛО ВІД САМОГО ПОЧАТКУ, і знайшлось воно не
  // оком, а підрахунком: 19 файлів у репозиторії проти 18 порівняних.
  // `deploy-infra.sh` розкладав `infra/lib/` із CAMP-349, а сторож про
  // цю теку не знав — тобто `env-value.sh`, яким бекап і перенос
  // таблиць читають `.env`, міг розійтися з машиною мовчки.
  lib: '/usr/local/lib/camptribe',
  // CAMP-353: строк зберігання безпекового журналу. Якщо цей файл на
  // машині розійдеться з репозиторієм, ми публікуємо в політиці
  // приватності строк, якого не дотримуємось, — і помітити це нічим.
  logrotate: '/etc/logrotate.d',
  // CAMP-353: камера над SSH. Розійдеться — перебір паролів знову
  // нікого не турбує, і дізнаємось ми про це з чужого входу.
  fail2ban: '/etc/fail2ban/jail.d',
});

/**
 * Файли, що лежать у репозиторії під ОДНИМ іменем, а на машині під
 * іншим. Теками їх не опишеш, тому вони перелічені парами.
 *
 * 🔴 ЦЬОГО НЕ БУЛО, І САМЕ ЦЕЙ ФАЙЛ ЗРОБИВ ПОЛІТИКУ НЕПРАВДОЮ. Конфіг
 * веб-сервера правився руками на машині й не звірявся ніколи: зміна в
 * один рядок 15.10 вимкнула журналювання, а опублікований текст про це
 * не дізнався. Рецензія CAMP-353 назвала це прямо — підрахунок «19
 * проти 18», яким я пишався, не бачив цілої теки.
 *
 * 🔴 `gate-closed.conf` ТУТ НЕМАЄ НАВМИСНО: у ньому пароль гейта, якого
 * в git немає. `assertNoSecretTarget` нижче стежить, щоб він сюди не
 * потрапив ні через неуважність, ні через зручність.
 */
export const NAMED = Object.freeze([
  { kind: 'caddy', name: 'camptribe.eu.caddyfile', remote: '/etc/caddy/Caddyfile' },
  { kind: 'caddy', name: 'gate-open.conf', remote: '/etc/caddy/gate-open.conf' },
  { kind: 'caddy', name: 'gate-closed.conf.example', remote: '/etc/caddy/gate-closed.conf.example' },
  // CAMP-384: замок адмінки Directus. Їде лише приклад — так само, як у гейта сайту.
  { kind: 'caddy', name: 'cms-gate.conf.example', remote: '/etc/caddy/cms-gate.conf.example' },
]);

/**
 * Шляхи, яких розкладка не сміє торкатись за жодних обставин: у кожному
 * лежить пароль, якого в git немає й не буде.
 *
 * 🔴 СПИСОК, А НЕ ОДИН РЯДОК, І ЦЕ ВИПРАВЛЕННЯ. До CAMP-384 тут був
 * єдиний шлях, тож коли зʼявився другий замок — для адмінки Directus —
 * він автоматично опинився ПОЗА охороною. Форма дефекту знайома: сторож
 * був правильний для світу, який щойно перестав існувати.
 */
export const FORBIDDEN_TARGETS = Object.freeze([
  '/etc/caddy/gate-closed.conf',
  '/etc/caddy/cms-gate.conf',
]);

/**
 * Пари, які РЕАЛЬНО розкладає `deploy-infra.sh` — прочитані з нього.
 *
 * 🔴 ЧИТАЄТЬСЯ ДАНИЙ БЛОК, А НЕ КОМЕНТАР. Сторож, що звіряється з
 * поясненням, підтверджує пояснення. Тут розбирається рядок
 * `CADDY_PAIRS="…"`, тобто саме те, чим скрипт користується.
 */
export function deployedPairs(text) {
  // 🔴 ДРУГЕ ПРИСВОЄННЯ — ЦЕ ПРОВАЛ, А НЕ «ВІЗЬМУ ПЕРШЕ». Рецензія
  // 19.10.2026 показала форму атаки: нижче за дві стрічки дописати
  //     CADDY_PAIRS+="\ngate-closed.conf:/etc/caddy/gate-closed.conf"
  // і розкладка понесе на машину пароль гейта, а сторож лишиться
  // зеленим 39/39 — бо `match` без прапорця бере ПЕРШЕ входження й
  // бачить ті самі безпечні пари. `FORBIDDEN_TARGETS` при цьому
  // дивиться на розібране, а не на розкладене.
  //
  // Тому питання не «що в першому присвоєнні», а «скільки разів цю
  // змінну взагалі пишуть». Один раз — розбираємо; інакше жодної
  // відповіді, і виклик нагорі читає це як провал.
  const writes = text.match(/^\s*CADDY_PAIRS\s*\+?=/gm) ?? [];
  if (writes.length !== 1) return null;
  const m = text.match(/^CADDY_PAIRS="([^"]*)"/m);
  if (!m) return null;
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(':');
      return { name: l.slice(0, i), remote: l.slice(i + 1) };
    });
}

/**
 * 🔴 БЕЗ ЗНАЧЕННЯ ЗА ЗАМОВЧУВАННЯМ, І ЦЕ НАВМИСНО. Репозиторій
 * публічний, тож адресу машини сюди вписувати не можна: відсутність
 * має читатись як помилка, а не як «візьму типову».
 *
 * 🔴 ЦЕЙ КОМЕНТАР БУВ НЕПРАВДОЮ З ДНЯ НАПИСАННЯ (CAMP-355). Тут
 * стояло «адреси продакшн-машини в ньому ще немає» — а вона лежала в
 * трьох файлах `docs/` і в пʼяти комітах історії. Коментар, що описує
 * неіснуючу властивість, гірший за його відсутність: наступний читач
 * на нього спирається.
 *
 * Тепер твердження не на слові, а під сторожем:
 * `scripts/ci/check-public-addresses.mjs` вимагає, щоб КОЖНА публічна
 * адреса в дереві була названа з причиною, і нашої в тому переліку
 * немає й не буде.
 */
export const SSH_HOST = process.env.CAMPTRIBE_HOST ?? '';
export const SSH_KEY =
  process.env.CAMPTRIBE_KEY ?? `${process.env.HOME}/.ssh/id_ed25519_camptribe_server`;

/** Усе, що ми беремося розкладати, парами «локально → на машині». */
export function managedFiles(readDir = readdirSync) {
  const out = [];
  for (const [dir, dest] of Object.entries(DESTINATION)) {
    for (const name of readDir(path.join(INFRA, dir))) {
      out.push({ kind: dir, name, local: path.join(INFRA, dir, name), remote: `${dest}/${name}` });
    }
  }
  for (const f of NAMED) {
    out.push({ kind: f.kind, name: f.name, local: path.join(INFRA, f.kind, f.name), remote: f.remote });
  }
  return out.sort((a, b) => a.remote.localeCompare(b.remote));
}

/**
 * Посилання юніта на те, що розкладаємо МИ.
 *
 * 🔴 Шукаємо лише під `/usr/local/bin` і лише шаблони `camptribe-*`:
 * `/usr/bin/node` і `postgresql.service` нам не належать, і вимагати
 * їх у репозиторії означало б скаржитись на кожен рядок.
 */
export function referencesIn(unitText) {
  const refs = [];
  for (const m of unitText.matchAll(/^(?:ExecStart|ExecStop|ExecReload)\s*=\s*-?(\S+)/gm)) {
    if (m[1].startsWith('/usr/local/bin/')) refs.push({ kind: 'bin', name: path.basename(m[1]) });
  }
  for (const m of unitText.matchAll(/^OnFailure\s*=\s*(\S+)/gm)) {
    // `camptribe-failed@%n.service` → шаблон `camptribe-failed@.service`
    const unit = m[1].replace(/@[^.]*\./, '@.');
    refs.push({ kind: 'systemd', name: unit });
  }
  return refs;
}

/** Корінь релізу на машині — симлінк, який перемикає деплой. */
export const RELEASE_ROOT = '/srv/camptribe/current';

/** Рушії, яким у `Exec*=` передають шлях до скрипта. */
const ENGINE = /\/(?:node|bash|sh|python3)$/;

/**
 * Шляхи ПІД РЕЛІЗОМ, які називає юніт.
 *
 * 🔴 ЦЕ ТОЙ САМИЙ РЯДОК, ЧЕРЕЗ ЯКИЙ УСЕ ПОЧАЛОСЬ — І ДО 14.10.2026
 * ЙОГО НІХТО НЕ ПЕРЕВІРЯВ. 13.10 бекап помер із `status=200/CHDIR`, бо
 * мав `WorkingDirectory=/srv/camptribe/app` — теку, яку прибрав
 * деплой. `--offline` при цьому друкував «посилань у порожнечу немає»:
 * він дивився лише на `/usr/local/bin` і на `OnFailure`. Репетирувано
 * 14.10.2026 — обидва написання помилки проходили зеленими.
 *
 * Перевірка, сліпа на власну причину смерті, не є перевіркою.
 */
export function releasePaths(unitText) {
  const out = [];
  const wdm = unitText.match(/^WorkingDirectory\s*=\s*(\S+)/m);
  const wd = wdm === null ? null : wdm[1];
  if (wd !== null) out.push({ key: 'WorkingDirectory', abs: wd });

  for (const m of unitText.matchAll(/^EnvironmentFile\s*=\s*-?(\S+)/gm)) {
    out.push({ key: 'EnvironmentFile', abs: m[1] });
  }

  for (const m of unitText.matchAll(
    /^Exec(?:Start|StartPre|StartPost|Stop|Reload)\s*=\s*-?(\S+)(.*)$/gm,
  )) {
    const [, bin, rest] = m;
    if (!ENGINE.test(bin)) continue;
    // Перший неопційний аргумент рушія — і є скрипт.
    const arg = rest.trim().split(/\s+/).find((a) => a !== '' && !a.startsWith('-'));
    if (arg === undefined) continue;
    out.push({ key: 'Exec', abs: arg.startsWith('/') ? arg : `${wd ?? RELEASE_ROOT}/${arg}` });
  }
  return out;
}

/**
 * Що деплой СТВОРЮЄ на машині сам — тобто чого в репозиторії немає
 * правильно. Кожен рядок названий тим рядком `infra/bin/camptribe-deploy`,
 * який його створює.
 *
 * 🔴 ТУТ СТОЯВ `git check-ignore`, І ЦЕ БУЛО ГІРШЕ ЗА СПИСОК. Рецензія
 * 14.10.2026 заміряла: `out/freshness.mjs`, `logs/x.mjs`,
 * `.env.production` і навіть `WorkingDirectory=…/current/out` проходили
 * МОВЧКИ, бо в `.gitignore` `out`, `dist`, `logs`, `coverage` і `.next`
 * записані голими й неприкріпленими — тож збігається будь-яка складова
 * шляху. Плюс вирок залежав від машини: `check-ignore` читає ще й
 * глобальні excludes, яких у CI немає.
 *
 * Я захищав `check-ignore` тим, що список довелось би доповнювати
 * після кожного нового юніта. Це неправда: список не про юніти, а про
 * те, що будує деплой, і змінюється він разом зі збіркою. А коротка
 * правильна відповідь краща за властивість, яка мовчки приймає `out/`.
 */
export const DEPLOY_CREATES = Object.freeze([
  'apps/api/dist/', // npm run build:api
  'apps/web/.next/', // npm run build:web
  'apps/api/.env', // install -m 600 … з чинного релізу
]);

export const madeByDeploy = (rel) =>
  DEPLOY_CREATES.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));

/**
 * Чи існує в репозиторії те, що юніт назвав під релізом.
 */
export function missingReleasePaths(files, opts = {}) {
  const read = opts.read ?? ((f) => readFileSync(f, 'utf8'));
  const exists = opts.exists ?? ((rel) => existsSync(path.join(ROOT, rel)));
  const bad = [];
  for (const f of files) {
    if (!f.name.endsWith('.service') && !f.name.endsWith('.timer')) continue;
    for (const ref of releasePaths(read(f.local))) {
      if (ref.abs !== RELEASE_ROOT && !ref.abs.startsWith(`${RELEASE_ROOT}/`)) {
        bad.push({ unit: f.name, missing: `${ref.key}=${ref.abs} — не під ${RELEASE_ROOT}` });
        continue;
      }
      const rel = ref.abs.slice(RELEASE_ROOT.length + 1);
      if (rel === '' || madeByDeploy(rel) || exists(rel)) continue;
      bad.push({ unit: f.name, missing: `${ref.key}=${ref.abs} — у репозиторії немає ${rel}` });
    }
  }
  return bad;
}

/**
 * Чи все, на що посилаються юніти, лежить поруч у репозиторії.
 *
 * Це рівно той дефект, що вбив бекап: рядок, який вказує в порожнечу.
 * Один прогін у CI, без мережі й без ключа.
 */
export function danglingReferences(files, read = (p) => readFileSync(p, 'utf8')) {
  // 🔴 РІД БЕРЕТЬСЯ З `kind`, А НЕ ВГАДУЄТЬСЯ ЗА ПРЕФІКСОМ. Тут стояло
  // `startsWith(DESTINATION.bin) ? 'bin' : 'systemd'` — двійковий вибір
  // при двох теках. CAMP-353 додав третю, і цей рядок мовчки зарахував
  // би конфіг logrotate до юнітів systemd: не впав би, не попередив,
  // просто відповідав би на інше питання.
  const have = new Set(files.map((f) => `${f.kind}:${f.name}`));
  const bad = [];
  for (const f of files) {
    if (!f.name.endsWith('.service') && !f.name.endsWith('.timer')) continue;
    for (const ref of referencesIn(read(f.local))) {
      if (!have.has(`${ref.kind}:${ref.name}`)) {
        bad.push({ unit: f.name, missing: `${ref.kind}/${ref.name}` });
      }
    }
  }
  return bad;
}

/** Рядки, що різняться. Порожньо — збіг побайтово. */
export function drift(pairs) {
  return pairs
    .filter((p) => p.expected !== p.actual)
    .map((p) => ({
      remote: p.remote,
      why: p.actual === null ? 'на машині немає' : 'вміст розійшовся',
    }));
}

/**
 * Чи протух щонічний бекап (CAMP-349, пункт 3).
 *
 * 🔴 ЦЕ ТЕ, ЧОГО НЕ ПИТАВ НІХТО, І САМЕ ТОМУ ТРИ НОЧІ ПІДРЯД МИНУЛИ
 * НЕПОМІЧЕНИМИ. `backup-verify.yml` репетирує повний цикл
 * «зберегти → знищити → відновити», але на фікстурі всередині CI: він
 * питає «чи відновлюється дамп», а не «чи зʼявився новий». 19.10.2026
 * він був зелений о 03:22Z, тоді як останній справжній бекап був від
 * 16.10 — тобто зелена перевірка бекапів при відсутніх бекапах.
 *
 * 🔴 ЧОМУ САМЕ ТУТ, А НЕ В CI. У жодного workflow немає доступу до
 * машини: ключа в репозиторії немає, а адресу з нього прибрано
 * (CAMP-355 — до 19.10.2026 вона там лежала, попри те що цей самий
 * коментар стверджував протилежне). Додавати CI ключ заради однієї
 * перевірки означало б розширити площу ураження; а цей сторож ключем
 * уже ходить, тож питання лягає туди, де зʼєднання вже є.
 *
 * 🔴 ЩО ВВАЖАЄТЬСЯ БЕКАПОМ. Тільки теки виду `YYYY-MM-DD` — це те, що
 * кладе щонічний `camptribe-backup`. Файли `predeploy-*.dump` поруч НЕ
 * рахуються: це знімки, які робить деплой перед собою, і їх наявність
 * якраз і створювала враження, що бекапи йдуть. 16.10 їх було три, а
 * щонічного — жодного.
 *
 * `entries`: `[{ name, mtime }]`, mtime в секундах епохи.
 * Поріг 30 годин, а не 24: таймер б'є раз на добу о 03:30 UTC, тож
 * нормальний вік бекапу коливається від 0 до 24 годин, і 24 рівно дало
 * б хибну тривогу щоранку перед самим прогоном.
 */
export function staleBackup(entries, nowEpoch, maxAgeHours = 30) {
  const dated = entries.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.name));
  if (dated.length === 0) return { stale: true, why: 'жодного щонічного бекапу немає', ageHours: null };
  const newest = dated.reduce((a, b) => (a.mtime >= b.mtime ? a : b));
  const ageHours = (nowEpoch - newest.mtime) / 3600;
  if (ageHours > maxAgeHours) {
    return { stale: true, why: `останній бекап ${newest.name}`, ageHours };
  }
  return { stale: false, why: null, ageHours };
}

const ssh = (cmd) =>
  execFileSync('ssh', ['-i', SSH_KEY, '-o', 'ConnectTimeout=10', SSH_HOST, cmd], {
    encoding: 'utf8',
    maxBuffer: 8 << 20,
  });

function offline() {
  const files = managedFiles();
  // 🔴 Два різні питання, і обидва про той самий рядок у порожнечу:
  // чи є поруч те, що РОЗКЛАДАЄМО МИ, і чи є в репозиторії те, що юніт
  // назвав ПІД РЕЛІЗОМ. Друге додано 14.10.2026 — без нього перевірка
  // не ловила причину, заради якої її написали.
  const bad = [...danglingReferences(files), ...missingReleasePaths(files)];
  if (bad.length > 0) {
    console.error('✗ юніт посилається на те, чого в репозиторії немає:\n');
    for (const b of bad) console.error(`  ${b.unit} → ${b.missing}`);
    console.error('\n  Саме так помер бекап 13.10.2026: рядок, що вказує в порожнечу.');
    return 1;
  }
  console.log(`✓ check-server-drift offline: ${files.length} файлів, посилань у порожнечу немає`);
  return 0;
}

function live() {
  // 🔴 ПЕРЕВІРКА ТУТ, А НЕ В `ssh()`. Кидок усередині циклу
  // проковтувався власним `try/catch` файлу й ставав `actual = null`,
  // тобто «на машині немає» — про КОЖЕН файл. Відсутня змінна
  // оточення читалась як «сервер порожній», і це найгірша можлива
  // форма помилки: гучна, правдоподібна і хибна.
  if (SSH_HOST === '') {
    console.error(
      'CAMPTRIBE_HOST не задано. Повне порівняння з машиною потребує адреси\n' +
        'й ключа; у репозиторії їх немає навмисно (репо публічне).\n\n' +
        '  CAMPTRIBE_HOST=root@… node scripts/ci/check-server-drift.mjs\n\n' +
        'Без ключа доступна перевірка, якій вистачає репозиторію:\n' +
        '  node scripts/ci/check-server-drift.mjs --offline',
    );
    return 2;
  }
  const files = managedFiles();
  const pairs = files.map((f) => {
    let actual = null;
    try {
      actual = ssh(`cat ${f.remote} 2>/dev/null || true`);
    } catch {
      actual = null;
    }
    return { remote: f.remote, expected: readFileSync(f.local, 'utf8'), actual: actual || null };
  });
  const bad = drift(pairs);

  // 🔴 Сліди падінь, які лишає `camptribe-failed`. Порожньо — добре;
  // «теки немає» теж добре, бо її створює лише перше падіння.
  let failed = '';
  try {
    failed = ssh('ls -1 /srv/camptribe/failed 2>/dev/null || true').trim();
  } catch {
    failed = '';
  }

  for (const p of pairs) {
    const mark = p.actual === null ? '—' : p.expected === p.actual ? '=' : '≠';
    console.log(`${mark} ${p.remote}`);
  }
  // 🔴 Свіжість бекапу — окреме питання від дрейфу файлів, і окремий
  // замок. Файли можуть збігатися з git ідеально, а бекапів не бути.
  let backup = { stale: false, why: null, ageHours: null };
  try {
    const raw = ssh(
      "find /srv/camptribe/backups -maxdepth 1 -mindepth 1 -type d -printf '%f %T@\\n' 2>/dev/null || true",
    );
    const entries = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [name, t] = l.split(/\s+/);
        return { name, mtime: Number(t) };
      });
    backup = staleBackup(entries, Date.now() / 1000);
  } catch {
    backup = { stale: true, why: 'не вдалося прочитати теку бекапів', ageHours: null };
  }

  if (failed !== '') {
    console.error(`\n✗ сліди падінь на машині: ${failed.split('\n').join(', ')}`);
  }
  if (backup.stale) {
    console.error(
      `\n✗ бекап протух: ${backup.why}` +
        (backup.ageHours === null ? '' : ` (${backup.ageHours.toFixed(1)} год тому)`),
    );
  } else {
    console.log(`\n✓ бекап свіжий: ${backup.ageHours.toFixed(1)} год тому`);
  }
  if (bad.length > 0) {
    console.error('\n✗ дрейф:');
    for (const b of bad) console.error(`  ${b.remote}: ${b.why}`);
  }
  if (bad.length === 0 && failed === '' && !backup.stale) {
    console.log('✓ машина збігається з git, слідів падінь немає');
    return 0;
  }
  return 1;
}

function selfTest() {
  const cases = [];
  let rc = 0;
  const is = (name, got, want) => {
    cases.push(name);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      rc = 1;
    }
  };

  // 🔴 ТРЕТЯ ТЕКА МУСИТЬ ЛИШАТИСЬ ТРЕТЬОЮ. Саме на цьому рядку
  // спіткнувся CAMP-353: `danglingReferences` ділив світ навпіл —
  // «це bin, решта systemd» — і конфіг logrotate став би юнітом
  // systemd мовчки. Перевірка нижче червоніє, щойно рід знову почнуть
  // вгадувати за шляхом замість читати з теки.
  {
    // 🔴 ФІКСТУРА БУДУЄТЬСЯ З `DESTINATION`, А НЕ ПЕРЕЛІЧУЄ ТЕКИ. Перша
    // редакція перелічувала — і впала тієї ж години, щойно CAMP-353
    // додав `fail2ban`: стаб віддав `undefined`, і тест не почервонів, а
    // ВПАВ зі стеком. Падіння й спіймана мутація виглядають по-різному
    // лише тоді, коли на них дивишся; у CI це однаково «не зелено».
    // Тепер нова тека автоматично стає ще одним випадком.
    const stub = (dir) => [`${path.basename(dir)}-fixture`];
    const got = managedFiles(stub);
    is('кожна тека лишається собою',
      got.map((f) => `${f.kind}:${f.remote}`).sort(),
      [
        ...Object.entries(DESTINATION).map(([k, d]) => `${k}:${d}/${k}-fixture`),
        ...NAMED.map((f) => `${f.kind}:${f.remote}`),
      ].sort());
    is('жодна тека не загубилась',
      got.length, Object.keys(DESTINATION).length + NAMED.length);
    is('рід не збігається в купу',
      new Set(got.map((f) => f.kind)).size, Object.keys(DESTINATION).length + 1);
  }

  // 🔴 СТОРОЖ І РОЗКЛАДКА МУСЯТЬ НАЗИВАТИ ОДНЕ Й ТЕ САМЕ. Два переліки
  // тих самих файлів у двох мовах — це рівно та форма, якою дрейф і
  // заходить: один оновили, другий ні, і обидва впевнені в собі.
  // Читається БЛОК ДАНИХ `CADDY_PAIRS` із bash-скрипта, тобто те, чим
  // він користується, а не коментар поруч.
  {
    const script = readFileSync(path.join(INFRA, 'deploy-infra.sh'), 'utf8');
    const pairs = deployedPairs(script);
    is('розкладка взагалі оголошує пари', Array.isArray(pairs), true);
    is('сторож і розкладка згодні щодо Caddy',
      (pairs ?? []).map((x) => `${x.name}:${x.remote}`).sort(),
      NAMED.map((x) => `${x.name}:${x.remote}`).sort());
    // 🔴 Пара до попереднього: порожній перелік задовольнив би збіг,
    // якби NAMED теж колись спорожнів.
    is('пар не нуль', (pairs ?? []).length > 0, true);
    // 🔴 Доданий рядок до тієї ж змінної має валити розбір, а не
    // «не помітитись». Саме так пароль гейта потрапив би на машину.
    is('друге присвоєння CADDY_PAIRS робить розбір неможливим',
      deployedPairs(`${script}\nCADDY_PAIRS+="\\ngate-closed.conf:/etc/caddy/gate-closed.conf"\n`),
      null);
    is('порожній скрипт теж не дає пар', deployedPairs('echo привіт\n'), null);
    // 🔴 ПЕРЕВІРЯЄМО КОЖЕН ЗАБОРОНЕНИЙ ШЛЯХ, А НЕ ПЕРШИЙ. Перевірка, що
    // мовчки бере один елемент зі списку, зеленіє і тоді, коли другий
    // замок лежить на машині беззахисним.
    for (const forbidden of FORBIDDEN_TARGETS) {
      is(`пароль не є ціллю розкладки: ${forbidden}`,
        [...(pairs ?? []).map((x) => x.remote), ...NAMED.map((x) => x.remote)]
          .filter((r) => r === forbidden),
        []);
      is(`приклад і справжній файл — різні: ${forbidden}`,
        NAMED.some((f) => f.remote === `${forbidden}.example`), true);
    }
    is('заборонених цілей рівно стільки, скільки замків', FORBIDDEN_TARGETS.length, 2);
  }

  // 🔴 Форма, що вбила бекап: рядок у юніті, який нікуди не веде.
  const unit = (body) => body;
  //
  // 🔴 ПЕРША ВЕРСІЯ ЦИХ ФІКСТУР БУЛА НЕПОВНА, І СТОРОЖ ЦЕ СКАЗАВ: юніт-
  // обробник посилається на `/usr/local/bin/camptribe-failed`, якого я
  // в список не поклав. Він мав рацію — це рівно той дефект, який він
  // шукає, тільки в моєму тесті.
  //
  // 🔴 `kind` ТУТ ОБОВʼЯЗКОВИЙ, І ЦЕ ДРУГИЙ РАЗ, КОЛИ ЦІ ФІКСТУРИ БУЛИ
  // НЕПОВНІ. Поки рід вгадувався за префіксом шляху, його можна було не
  // писати — і чотири перевірки нижче зеленіли над записами, яких
  // `managedFiles()` ніколи не віддає. Фікстура, що відрізняється від
  // справжніх даних саме тим полем, яке читає перевірка, доводить лише
  // саму себе.
  const files = [
    { kind: 'systemd', name: 'a.service', local: 'a', remote: '/etc/systemd/system/a.service' },
    { kind: 'systemd', name: 'camptribe-failed@.service', local: 'h', remote: '/etc/systemd/system/camptribe-failed@.service' },
    { kind: 'bin', name: 'camptribe-backup', local: 'b', remote: '/usr/local/bin/camptribe-backup' },
    { kind: 'bin', name: 'camptribe-failed', local: 'f', remote: '/usr/local/bin/camptribe-failed' },
  ];
  const texts = {
    a: unit('[Service]\nExecStart=/usr/local/bin/camptribe-backup\n'),
    h: unit('[Service]\nExecStart=/usr/local/bin/camptribe-failed %i\n'),
    b: '#!/bin/bash\n',
    f: '#!/bin/bash\n',
  };
  const read = (p) => texts[p];

  // 🔴 ВИПАДОК НАВМИСНО ШТУЧНИЙ, І ЦЕ ЄДИНА ЙОГО ФОРМА. Мутаційний
  // прогін 19.10.2026 показав, що повернення старого рядка
  // (`startsWith(DESTINATION.bin) ? 'bin' : 'systemd'`) переживає всі
  // 32 випадки: на теках `systemd` і `bin` обидві реалізації дають те
  // саме. Розрізняє їх лише файл ЧУЖОГО роду з імʼям юніта — тоді
  // старий рядок каже «systemd», і посилання на неіснуючий юніт
  // виглядає задоволеним. Перевірка без жодної мутації, яка її валить,
  // — це галочка, зелена за побудовою.
  is('файл чужого роду не вдає юніт',
    danglingReferences(
      [files[0], files[2], { kind: 'logrotate', name: 'camptribe-failed@.service', local: 'r', remote: '/etc/logrotate.d/camptribe-failed@.service' }],
      (q) => (q === 'a' ? '[Unit]\nOnFailure=camptribe-failed@%n.service\n[Service]\nExecStart=/usr/local/bin/camptribe-backup\n' : '#!/bin/bash\n'),
    ).map((b) => b.missing),
    ['systemd/camptribe-failed@.service']);

  is('усе на місці — скарг немає', danglingReferences(files, read), []);
  is('скрипт, якого немає в репозиторії',
    danglingReferences([files[0], files[1], files[3]], read).map((b) => b.missing),
    ['bin/camptribe-backup']);
  is('OnFailure на шаблон, якого немає',
    danglingReferences(
      [{ ...files[0] }, files[2]],
      (p) => (p === 'a' ? '[Unit]\nOnFailure=camptribe-failed@%n.service\n[Service]\nExecStart=/usr/local/bin/camptribe-backup\n' : '#!/bin/bash\n'),
    ).map((b) => b.missing),
    ['systemd/camptribe-failed@.service']);
  is('OnFailure на шаблон, який Є',
    danglingReferences(files, (p) =>
      p === 'a'
        ? '[Unit]\nOnFailure=camptribe-failed@%n.service\n[Service]\nExecStart=/usr/local/bin/camptribe-backup\n'
        : texts[p],
    ),
    []);
  // 🔴 Чуже не вимагаємо: /usr/bin/node і postgresql.service не наші.
  is('чужі шляхи не рахуються',
    referencesIn('[Unit]\nAfter=postgresql.service\n[Service]\nExecStart=/usr/bin/node dist/main\n'),
    []);
  is('ExecStart із дефісом теж читається',
    referencesIn('ExecStart=-/usr/local/bin/camptribe-backup\n').map((r) => r.name),
    ['camptribe-backup']);

  is('дрейф: збіг — порожньо',
    drift([{ remote: '/x', expected: 'a', actual: 'a' }]), []);
  is('дрейф: вміст розійшовся',
    drift([{ remote: '/x', expected: 'a', actual: 'b' }]).map((d) => d.why), ['вміст розійшовся']);
  is('дрейф: на машині немає',
    drift([{ remote: '/x', expected: 'a', actual: null }]).map((d) => d.why), ['на машині немає']);
  // 🔴 Порожній файл на машині — це НЕ «збігається»: `cat` неіснуючого
  // дає порожньо, і без цього випадку відсутність читалась би як збіг.
  is('порожнє на машині проти непорожнього в git',
    drift([{ remote: '/x', expected: 'a', actual: '' }]).length, 1);

  // ── шляхи під релізом (CAMP-170) ──────────────────────────────────
  //
  // 🔴 ЦІ ВІСІМ ВИПАДКІВ Є ТОМУ, ЩО 14.10.2026 Я ЗАМІРЯВ: обидва
  // написання дефекту, який убив бекап 13.10, проходили `--offline`
  // зеленими. Перевірка бачила `/usr/local/bin` і `OnFailure`, а
  // `WorkingDirectory` не читала взагалі.
  const freshUnit =
    'WorkingDirectory=/srv/camptribe/current\n' +
    'EnvironmentFile=/srv/camptribe/current/apps/api/.env\n' +
    'ExecStart=/usr/bin/node scripts/ci/x.mjs --stale-only\n' +
    'ExecStartPost=/bin/rm -f /srv/camptribe/failed/u.service\n';

  is('робоча тека прочитана',
    releasePaths(freshUnit).filter((r) => r.key === 'WorkingDirectory').map((r) => r.abs),
    ['/srv/camptribe/current']);
  // 🔴 Відносний шлях розвʼязується проти РОБОЧОЇ ТЕКИ юніта, а не
  // проти кореня релізу: інакше юніт з `WorkingDirectory=.../apps/api`
  // перевірявся б не за тим шляхом і мовчав би про справжню помилку.
  is('відносний аргумент розвʼязано проти робочої теки',
    releasePaths('WorkingDirectory=/srv/camptribe/current/apps/api\nExecStart=/usr/bin/node dist/main\n')
      .filter((r) => r.key === 'Exec').map((r) => r.abs),
    ['/srv/camptribe/current/apps/api/dist/main']);
  is('🔴 береться скрипт, а не прапорець',
    releasePaths(freshUnit).filter((r) => r.key === 'Exec').map((r) => r.abs),
    ['/srv/camptribe/current/scripts/ci/x.mjs']);
  // `/usr/local/bin/camptribe-backup` і `/bin/rm` — не рушії; перший
  // перевіряє `danglingReferences`, другий нам не належить.
  // 🔴 ФІКСТУРА МАЄ НЕОПЦІЙНИЙ АРГУМЕНТ, І ЦЕ ВАЖЛИВО ДВІЧІ.
  //
  // Без аргументу випадок був підписом: `find()` однаково повертав
  // `undefined`, тож зняття `if (!ENGINE.test(bin))` його не валило
  // (рецензія 14.10). З аргументом-ПРАПОРЦЕМ — так само, бо `find()`
  // пропускає і його; я наступив на це під час самого виправлення.
  // Червоніти цей випадок може лише на неопційному аргументі.
  is('чужий виконуваний файл сюди не потрапляє',
    releasePaths('ExecStart=/usr/local/bin/camptribe-backup weekly\n').length, 0);
  // 🔴 І окремо: блок EnvironmentFile теж мусить мати свого свідка —
  // третина функції не була стверджена нічим.
  is('EnvironmentFile прочитано',
    releasePaths(freshUnit).filter((r) => r.key === 'EnvironmentFile').map((r) => r.abs),
    ['/srv/camptribe/current/apps/api/.env']);

  const files2 = [{ name: 'u.service', local: 'u' }];
  const probe = (text, opts) =>
    missingReleasePaths(files2, { read: () => text, ...opts }).map((b) => b.missing);

  is('🔴 тека поза релізом — саме дефект 13.10',
    probe('WorkingDirectory=/srv/camptribe/app\n', { exists: () => true }),
    ['WorkingDirectory=/srv/camptribe/app — не під /srv/camptribe/current']);
  is('🔴 відсутнє — скарга',
    probe('ExecStart=/usr/bin/node scripts/ci/x.mjs\n', { exists: () => false }),
    ['Exec=/srv/camptribe/current/scripts/ci/x.mjs — у репозиторії немає scripts/ci/x.mjs']);

  // ── ВИРОБНИЧЕ ПІДКЛЮЧЕННЯ, БЕЗ ЖОДНОГО ПІДМІННИКА ─────────────────
  //
  // 🔴 Рецензія 14.10.2026: усі випадки вище підставляли власний
  // `exists`, тож мутації ДЕФОЛТНОГО `exists → () => true` і
  // дефолтного правила «відсутнє правильно → завжди» обидві лишали
  // 18/18 зеленими. А вирок у `--offline` ухвалюють саме дефолти.
  const real = (text) => missingReleasePaths(files2, { read: () => text }).map((b) => b.missing);

  is('справжній файл репозиторію — мовчання',
    real('ExecStart=/usr/bin/node scripts/ci/check-data-freshness.mjs --stale-only\n'), []);
  is('🔴 справжньої відсутності не прощає',
    real('ExecStart=/usr/bin/node scripts/ci/nope.mjs\n'),
    ['Exec=/srv/camptribe/current/scripts/ci/nope.mjs — у репозиторії немає scripts/ci/nope.mjs']);
  is('те, що деплой будує сам, відсутнє правильно',
    real('WorkingDirectory=/srv/camptribe/current/apps/api\nExecStart=/usr/bin/node dist/main\n'), []);

  // 🔴 ТРИ ВХОДИ, ЯКІ `git check-ignore` ПРОПУСКАВ МОВЧКИ. Кожен тут
  // тому, що був заміряний як хибне проходження, а не вигаданий.
  is('🔴 out/ більше не ковтається',
    real('ExecStart=/usr/bin/node out/freshness.mjs\n').length, 1);
  is('🔴 logs/ більше не ковтається',
    real('ExecStart=/usr/bin/node logs/x.mjs\n').length, 1);
  is('🔴 .env.production більше не ковтається',
    real('EnvironmentFile=/srv/camptribe/current/.env.production\n').length, 1);

  // 🔴 CAMP-349, пункт 3: «перевірка мусить ЧЕРВОНІТИ, коли свіжого
  // бекапу немає». Нижче — рівно той стан машини, що був 19.10.2026,
  // коли все виглядало гаразд.
  const H = 3600;
  const now = 1_760_000_000;
  const ok = [{ name: '2026-10-19', mtime: now - 2 * H }];
  is('свіжий бекап не тривожить', staleBackup(ok, now).stale, false);
  is('бекап за 29 год ще нормальний',
    staleBackup([{ name: '2026-10-18', mtime: now - 29 * H }], now).stale, false);
  is('🔴 бекап за 31 год — тривога',
    staleBackup([{ name: '2026-10-18', mtime: now - 31 * H }], now).stale, true);
  is('🔴 три пропущені ночі — тривога',
    staleBackup([{ name: '2026-10-16', mtime: now - 72 * H }], now).stale, true);
  is('🔴 порожня тека — тривога, а не тиша',
    staleBackup([], now).stale, true);
  // 🔴 ЦЕ ВИПАДОК, ЩО ВІДТВОРЮЄ САМ ДЕФЕКТ. 16.10 поруч лежали три
  // свіжі `predeploy-*.dump`, і саме вони створювали враження, що
  // бекапи йдуть. Якщо їх рахувати — перевірка лишиться зеленою.
  is('🔴 predeploy-дампи не вважаються щонічним бекапом',
    staleBackup(
      [
        { name: '2026-10-16', mtime: now - 72 * H },
        { name: 'predeploy-61142c4-20261016T230718Z.dump', mtime: now - 1 * H },
      ],
      now,
    ).stale,
    true);
  is('найсвіжіша тека вирішує, а не перша в переліку',
    staleBackup(
      [
        { name: '2026-10-16', mtime: now - 72 * H },
        { name: '2026-10-19', mtime: now - 2 * H },
      ],
      now,
    ).stale,
    false);

  const EXPECTED_CASES = 44;   // CAMP-384: +3 (другий замок у FORBIDDEN_TARGETS)
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-server-drift self-test: ${cases.length} випадків`);
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test', '--offline'],
    'check-server-drift.mjs',
  );
  if (action.has('--self-test')) process.exit(selfTest());
  process.exit(action.has('--offline') ? offline() : live());
}
