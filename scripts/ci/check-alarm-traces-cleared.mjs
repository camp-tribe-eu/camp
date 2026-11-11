#!/usr/bin/env node
// CAMP-483: юніт, що тривожить, мусить уміти замовкнути.
//
//   node scripts/ci/check-alarm-traces-cleared.mjs
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ ІСНУЄ. Заміряно 11.11.2026: `camptribe-infra-drift`
// клав слід у `/srv/camptribe/failed` і НЕ прибирав його навіть після
// зеленого прогону. Лист власнику обіцяє протилежне — «слід зникає сам
// лише після УСПІШНОГО прогону юніта», — тож тривога повторювалася б
// щодванадцять годин про давно полагоджене.
//
// Тривога, яка не замовкає, гірша за відсутність тривоги: першу
// навчаються ігнорувати, і разом із нею ігнорують справжню.
//
// 🔴 `camptribe-failed@` — ВИНЯТОК, І ВІН ІМЕНОВАНИЙ. Цей юніт слід
// СТВОРЮЄ; прибирати його власний слід означало б прибирати чужий.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'infra', 'systemd');

/** Юніт, чия робота — записувати чужі падіння. */
const RECORDER = 'camptribe-failed@.service';

function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.service'));
  const alarming = [];
  const silent = [];

  for (const f of files) {
    const body = readFileSync(join(DIR, f), 'utf8');
    if (!body.includes('OnFailure=camptribe-failed')) continue;
    if (f === RECORDER) continue;
    alarming.push(f);
    if (!/ExecStartPost=\/bin\/rm\s+-f\s+\/srv\/camptribe\/failed\//.test(body)) {
      silent.push(f);
    }
  }

  // 🔴 ЗНАМЕННИК. «Жодного порушника» над нулем перевірених юнітів
  // виглядає так само, як справжня чистота — і саме так виглядала б
  // помилка в шляху до теки.
  console.log(`перевірено ${alarming.length} юнітів, що тривожать (файлів ${files.length})`);
  if (alarming.length < 5) {
    console.error('🔴 юнітів із тривогою підозріло мало — перевір шлях до infra/systemd');
    return 2;
  }
  if (silent.length === 0) {
    console.log('кожен прибирає свій слід після успішного прогону');
    return 0;
  }
  console.error(`\n🔴 тривожать, але слід не прибирають (${silent.length}):`);
  for (const f of silent) console.error(`  • ${f}`);
  console.error(
    '\nДодай рядок, яким це роблять решта:\n' +
      '  ExecStartPost=/bin/rm -f /srv/camptribe/failed/<юніт>.service',
  );
  return 1;
}

process.exit(main());
