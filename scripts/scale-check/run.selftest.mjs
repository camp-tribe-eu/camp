#!/usr/bin/env node
// CAMP-134: the scale gate in run.sh, rehearsed against a stub API.
//
//   node scripts/scale-check/run.selftest.mjs
//
// 🔴 WHY. run.sh refuses to run a single probe unless the API it was
// pointed at holds 10 000 campsites, answers with a number, and answers
// at all. Pointing it at a fixture is one wrong variable away, and every
// probe passes over a fixture — that is the failure the whole directory
// exists to stop. So the gate is the one piece of run.sh whose logic is
// worth proving on every PR, and it needs no dataset to prove: a stub
// that answers `{"spots": 72}` is enough to show the gate shuts, and one
// that answers 61 557 is enough to show it opens and prints the number.
//
// Until 04.11.2026 none of this ran anywhere: the workflow waited on a
// self-hosted runner that did not exist. Now the gate runs here on
// GitHub's runners, and the probes behind it run from the machine's
// timer (infra/systemd/camptribe-scale-check.service).
//
// The token the stub is handed is a made-up string, and the last case
// checks it never reaches the output — run.sh promises that.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_SH = path.join('scripts', 'scale-check', 'run.sh');
// 🔴 Слово «placeholder» тут не прикраса — це домовленість сторожа
// секретів: правило «assigned credential» у `check-secrets.mjs` ігнорує
// значення зі словами placeholder/dummy/example, бо саме такі й мають
// стояти в тестах. Без нього сторож червонив цей рядок (заміряно:
// «1 possible secret(s): run.selftest.mjs:30»), і спокуса була б
// перейменувати змінну — тобто обійти сторожа, а не домовитись із ним.
const TOKEN = 'placeholder-token-for-the-selftest';

/** A stub API whose answers the cases set one at a time. */
async function stub() {
  const state = { countries: 200, summary: '{"spots":0}' };
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/spots/countries')) {
      res.writeHead(state.countries, { 'content-type': 'application/json' });
      res.end('[]');
    } else if (url.startsWith('/spots/summary')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(state.summary);
    } else {
      // Nothing else is served: a probe that reaches past the gate on
      // this stub must FAIL, never pass over it.
      res.writeHead(404);
      res.end('not here');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { state, port, close: () => new Promise((r) => server.close(r)) };
}

/**
 * 🔴 `spawn`, not `spawnSync`. The stub above lives on THIS event loop,
 * and a synchronous child would hold it — the first version did, and
 * every case that needed an answer from the stub waited out curl's
 * 180 s before failing. Caught on the first run, kept here so it is not
 * rediscovered.
 */
function runSh(env, args = []) {
  return new Promise((resolve) => {
    const child = spawn('bash', [RUN_SH, ...args], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME ?? '', ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (rc) => resolve({ rc, out }));
  });
}

async function main() {
  let pass = 0;
  let fail = 0;
  const t = (name, ok, detail = '') => {
    if (ok) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.log(`  ✗ ${name}${detail ? `\n${detail.replace(/^/gm, '      ')}` : ''}`);
    }
  };
  const shuts = async (name, env, phrase) => {
    const r = await runSh(env);
    t(`${name}: exit ${r.rc}, says "${phrase}"`, r.rc === 1 && r.out.includes(phrase), r.out);
  };

  const api = await stub();
  const at = `http://127.0.0.1:${api.port}`;

  await shuts('🔴 no token', { API_BASE_URL: at }, 'API_BUILD_TOKEN is not set');

  // A port nothing listens on: take one from a server, then close it.
  const gone = await stub();
  await gone.close();
  await shuts('🔴 nothing listening', { API_BASE_URL: `http://127.0.0.1:${gone.port}`, API_BUILD_TOKEN: TOKEN },
    'nothing is listening');

  api.state.countries = 429;
  await shuts('🔴 429 is named as "not with success", not as "no API"',
    { API_BASE_URL: at, API_BUILD_TOKEN: TOKEN }, 'not with success (curl exit 22)');
  api.state.countries = 200;

  api.state.summary = '{"spots":72}';
  await shuts('🔴 72 campsites is a fixture', { API_BASE_URL: at, API_BUILD_TOKEN: TOKEN }, 'That is a fixture');

  api.state.summary = '{"spots":"61557"}';
  await shuts('🔴 a count that is a string is not a count', { API_BASE_URL: at, API_BUILD_TOKEN: TOKEN },
    'not a campsite count');

  api.state.summary = '{"spots":99999999999999999999}';
  await shuts('🔴 an unsafe integer is not a count', { API_BASE_URL: at, API_BUILD_TOKEN: TOKEN },
    'not a campsite count');

  api.state.summary = '<html>';
  await shuts('🔴 a summary that is not JSON', { API_BASE_URL: at, API_BUILD_TOKEN: TOKEN }, 'summary was not JSON');

  // The gate OPENS on the real number, prints it, and what follows fails
  // on this stub — exactly the unit's own command, `--nightly --api-only`.
  api.state.summary = '{"spots":61557}';
  const open = await runSh({ API_BASE_URL: at, API_BUILD_TOKEN: TOKEN }, ['--nightly', '--api-only']);
  t('🔴 61 557 opens the gate and the journal line carries the number',
    open.out.includes('scale-check against 61557 campsites'), open.out);
  t('--api-only says in the log that the census was not run',
    open.out.includes('--api-only: the OSM column census is not run here'), open.out);
  t('🔴 past the gate, a stub with no map routes FAILS the run rather than passing it',
    open.rc === 1 && open.out.includes('scale check(s) failed'), open.out);
  t('the map rehearsal ran its offline cases first',
    open.out.includes('check-map-index self-test: ran'), open.out);
  t('🔴 the token is never printed', !open.out.includes(TOKEN));

  const unknown = await runSh({ API_BASE_URL: at, API_BUILD_TOKEN: TOKEN }, ['--no-such-flag']);
  t('an unknown flag is exit 2, not a quiet default', unknown.rc === 2 && unknown.out.includes('unknown argument'), unknown.out);

  await api.close();
  console.log(`\nscale-check run.sh self-test: ran ${pass + fail}, passed ${pass}, failed ${fail}`);
  return fail === 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(`\n✗ ${e.message}`);
      process.exit(1);
    },
  );
}
