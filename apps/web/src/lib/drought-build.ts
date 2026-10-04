import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { droughtState, type DroughtState } from './drought';

// CAMP-163 — reading the two committed drought files, once per build.
//
// 🔴 SERVER ONLY, AND SEPARATE FROM `drought.ts` ON PURPOSE.
//
// `drought.ts` is pure: given the two parsed files, a clock and a
// decoder, it returns a state. That is what the tests drive, and it owes
// nothing to Node. This file is the half that cannot be pure — it reads
// the filesystem and gunzips — and keeping it apart means a test of the
// rules never has to own a gzip implementation or a fixture directory.
//
// 🔴 ONCE, not once per campsite. The site builds 65 435 pages; parsing
// 103 KB of JSON and inflating 1.1 MB of grid for each of them would be
// 65 435 × that, for one byte of answer per page. The module scope is the
// cache, and it is correct here precisely because the data cannot change
// during a build: both files are committed.
//
// 🔴 And it never throws. A missing or malformed file must render "no
// drought reading" on 65 435 pages, not fail 65 435 builds —
// `droughtState` already turns every unreadable shape into `missing`,
// and the catch below covers the one case it cannot see, which is the
// file not being there at all.

const DATA = join(process.cwd(), 'src', 'data');

const decode = (s: string): Uint8Array =>
  new Uint8Array(gunzipSync(Buffer.from(s, 'base64')));

let cached: DroughtState | null = null;

export function droughtAtBuild(now = new Date()): DroughtState {
  if (cached) return cached;
  try {
    const data = JSON.parse(readFileSync(join(DATA, 'drought.json'), 'utf8'));
    const domain = JSON.parse(readFileSync(join(DATA, 'drought-domain.json'), 'utf8'));
    cached = droughtState(data, domain, now, decode);
  } catch {
    cached = { kind: 'missing' };
  }
  return cached;
}
