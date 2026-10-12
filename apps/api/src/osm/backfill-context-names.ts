#!/usr/bin/env node
/**
 * CAMP-295 — перезаписати назви в уже обчисленому `context`.
 *
 * 🔴 ЧОМУ ОКРЕМИЙ СКРИПТ, А НЕ ПОВТОРНИЙ `compute-context`.
 *
 * `compute-context.ts` рахує все заново: воду, магазини, станції — і
 * ходить по висоту в Open-Meteo на КОЖЕН кемпінг. На 63 031 рядку це
 * десятки тисяч зовнішніх запитів заради зміни, яка не потребує
 * жодного: назви вже лежать у `context`, треба лише пропустити їх
 * крізь `displayName`.
 *
 * Скрипт ідемпотентний: другий прогін нічого не змінює, бо
 * `displayName` на вже транслітерованій назві віддає її ж.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { displayName } from './compute-context';

const FIELDS = ['town', 'water', 'supermarket', 'station'] as const;

export function rewriteNames(context: Record<string, unknown>): {
  next: Record<string, unknown>;
  changed: number;
  dropped: number;
} {
  const next = { ...context };
  let changed = 0;
  let dropped = 0;

  for (const key of FIELDS) {
    const node = next[key] as { name?: string } | undefined;
    if (!node || typeof node.name !== 'string') continue;

    const clean = displayName(node.name);
    if (clean === node.name) continue;

    const copy = { ...node };
    if (clean === null) {
      delete copy.name;
      dropped++;
    } else {
      copy.name = clean;
      changed++;
    }
    next[key] = copy;
  }

  return { next, changed, dropped };
}

async function main(apply: boolean): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const { rows } = await db.query<{
    id: string;
    context: Record<string, unknown>;
  }>(`SELECT id, context FROM camping_spots WHERE context IS NOT NULL`);

  let touched = 0;
  let changed = 0;
  let dropped = 0;

  for (const row of rows) {
    const result = rewriteNames(row.context);
    if (result.changed === 0 && result.dropped === 0) continue;
    touched++;
    changed += result.changed;
    dropped += result.dropped;
    if (apply) {
      await db.query(`UPDATE camping_spots SET context = $2 WHERE id = $1`, [
        row.id,
        result.next,
      ]);
    }
  }

  console.log(
    `${apply ? 'записано' : 'СУХИЙ ПРОГІН'}: ${rows.length} рядків прочитано, ` +
      `${touched} зачеплено, ${changed} назв перезаписано, ${dropped} прибрано`,
  );
  await db.end();
}

// 🔴 Сторож точки входу: нічого не виконується на import.
// Форма та сама, що в `compute-context.ts` — `import.meta` тут
// недоступна, бо tsconfig API компілює в CommonJS.
if (require.main === module) {
  // 🔴 За замовчуванням СУХИЙ прогін: скрипт пише в продакшн-базу, і
  // запуск без прапорця не сміє її змінити.
  void main(process.argv.includes('--apply'));
}
