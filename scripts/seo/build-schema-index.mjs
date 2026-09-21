#!/usr/bin/env node
// CAMP-37: turn the schema.org vocabulary into a small index we can ship.
//
//   node scripts/seo/build-schema-index.mjs
//
// Writes scripts/seo/schema-index.json, which the validator reads.
//
// 🔴 Why an index instead of fetching the vocabulary in CI: the full file
// is 1.5 MB and lives on schema.org. A validator that needs the network
// fails when someone else's site is down, and a CI step that passes
// because a download failed is worse than no CI step. The index is
// committed, so the check is hermetic and reviewable in a diff.
//
// Regenerate it deliberately, when schema.org publishes a new release —
// not on every build. A vocabulary that changes under us without a commit
// is exactly the silent drift this whole card is about.

import { writeFileSync } from 'node:fs';

const SOURCE = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';
const OUT = new URL('./schema-index.json', import.meta.url);

const short = (id) => (typeof id === 'string' ? id.replace(/^schema:/, '') : id);
const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
// `@type` is a bare string ("rdfs:Class"); subClassOf and domainIncludes
// are objects ({"@id": "schema:Place"}). Both shapes appear in the same
// document, so this accepts either rather than assuming one.
const ids = (v) =>
  list(v)
    .map((x) => short(typeof x === 'string' ? x : x?.['@id']))
    .filter(Boolean);

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`schema.org returned HTTP ${res.status}`);
const graph = (await res.json())['@graph'];

/** type → its direct parents. Properties are inherited down this chain. */
const parents = {};
/** property → the types it may appear on (domainIncludes). */
const domains = {};
const properties = new Set();
const types = new Set();

for (const node of graph) {
  const id = short(node['@id']);
  if (!id || id.includes('/')) continue;
  const kind = ids(node['@type']);

  if (kind.includes('rdfs:Class')) {
    types.add(id);
    const up = ids(node['rdfs:subClassOf']).filter((p) => !p.includes(':'));
    if (up.length) parents[id] = up;
  }
  if (kind.includes('rdf:Property')) {
    properties.add(id);
    const on = ids(node['schema:domainIncludes']).filter((p) => !p.includes(':'));
    if (on.length) domains[id] = on;
  }
}

const index = {
  source: SOURCE,
  generated: new Date().toISOString().slice(0, 10),
  types: [...types].sort(),
  properties: Object.fromEntries(
    [...properties].sort().map((p) => [p, domains[p] ?? []]),
  ),
  parents,
};

writeFileSync(OUT, JSON.stringify(index));
console.log(
  `schema-index.json: ${index.types.length} types, ` +
    `${Object.keys(index.properties).length} properties`,
);
