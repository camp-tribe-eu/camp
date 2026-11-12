#!/usr/bin/env node
// Кожен допис блогу у ВІДДАНІЙ сторінці несе примітку про походження
// тексту (`data-provenance`, непорожню). Вона лежить у даних
// (`page_sections`, variant = provenance), тож сторож дивиться на HTML,
// а не на код чи міграцію.
//
//   node scripts/ci/check-post-provenance.mjs              # по зібраних сторінках
//   node scripts/ci/check-post-provenance.mjs --base URL   # по живому сайту
//   node scripts/ci/check-post-provenance.mjs --self-test
//
// Не перевіряє, ЩО саме написано: власник, переписавши допис, ставить своє
// авторство. Перевіряє, що примітка є, і називає допис, де її немає.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const BUILD = 'apps/web/.next/server/app/blog';

/** Текст примітки або `null`, якщо її в HTML немає чи вона порожня. */
export function provenanceNote(html) {
  const m = html.match(/<div data-provenance(?:="[^"]*")?>([\s\S]*?)<\/div>/i);
  if (!m) return null;
  const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length >= 10 ? text : null;
}

export function postSlugsFromIndex(html) {
  return [...new Set([...html.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((x) => x[1]))].filter(
    (s) => s !== 'page',
  );
}

async function fromSite(base) {
  const slugs = new Set();
  for (let n = 1; n < 50; n++) {
    const r = await fetch(`${base}/blog${n > 1 ? `/page/${n}` : ''}`);
    if (!r.ok) break;
    const found = postSlugsFromIndex(await r.text());
    if (found.length === 0) break;
    found.forEach((s) => slugs.add(s));
  }
  const pages = [];
  for (const s of slugs) pages.push({ slug: s, html: await (await fetch(`${base}/blog/${s}`)).text() });
  return pages;
}

function fromBuild() {
  if (!existsSync(BUILD)) return [];
  return readdirSync(BUILD)
    .filter((f) => f.endsWith('.html'))
    .map((f) => ({ slug: path.basename(f, '.html'), html: readFileSync(path.join(BUILD, f), 'utf8') }));
}

function selfTest() {
  const ok = '<main><p>x</p><div data-provenance="true"><p>This article was composed by AI.</p></div></main>';
  const cases = [
    ['є примітка', provenanceNote(ok) !== null],
    ['немає примітки', provenanceNote('<main><p>x</p></main>') === null],
    ['порожня примітка', provenanceNote('<div data-provenance="true"><p> </p></div></main>') === null],
    ['слаги з переліку', postSlugsFromIndex('<a href="/blog/a-b"></a><a href="/blog/a-b"></a><a href="/blog/page/2"></a>').join() === 'a-b'],
  ];
  const bad = cases.filter(([, pass]) => !pass);
  bad.forEach(([n]) => console.error(`  ✗ ${n}`));
  console.log(bad.length ? `✗ ${bad.length} check(s) failed` : `✓ check-post-provenance self-test: ${cases.length} cases`);
  return bad.length ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const i = args.indexOf('--base');
  const pages = i >= 0 ? await fromSite(args[i + 1]) : fromBuild();
  // 🔴 Нуль дописів — не перемога: або збірки нема, або блог порожній.
  if (pages.length === 0) {
    console.error('✗ жодного допису для перевірки (немає збірки чи блог порожній) — нуль не доводить нічого.');
    return 1;
  }
  const missing = pages.filter((p) => provenanceNote(p.html) === null).map((p) => p.slug);
  console.log(`дописів перевірено: ${pages.length}`);
  if (missing.length === 0) {
    console.log('✓ кожен допис має примітку про походження тексту');
    return 0;
  }
  missing.forEach((s) => console.error(`✗ /blog/${s}: немає примітки про походження тексту`));
  return 1;
}

process.exitCode = await main();
