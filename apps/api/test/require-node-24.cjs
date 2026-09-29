'use strict';

// CAMP-159. Jest's globalSetup: refuse to run on a Node that cannot load Nest.
//
// 🔴 Nest 12 ships as ESM. A CommonJS spec reaches it through require(esm),
// which Jest 30 implements only where `vm.SourceTextModule` has
// `hasAsyncGraph` — Node >= 24.9, and only under --experimental-vm-modules
// ("On older Node, fall through to the CJS path so a configured transform can
// convert it" — jest-runtime). Anywhere else every spec that imports
// @nestjs/* dies at its first line with
//
//     Must use import to load ES Module: …/node_modules/@nestjs/common/index.js
//
// which reads like a broken install rather than a wrong Node. It happened: the
// first version of this change was green on a Node 24 laptop and red on CI's
// Node 22.23.2, and the message did not say why.
//
// The predicate below is the one Jest itself tests, copied rather than
// paraphrased as a version number, so this cannot disagree with Jest — a
// Node 22 that one day backports `hasAsyncGraph` will simply start passing.
//
// The API itself runs on Node 22 — measured on 22.23.2: it boots, and the
// build-bypass probe passes 10/10. This is about the test runner only.
//
// Tried instead, and abandoned: transforming @nestjs/* to CommonJS inside
// Jest. It works until the next package declares `const require =
// createRequire(import.meta.url)` — which @nestjs/typeorm already does — and
// a hand-rolled ESM-to-CJS bridge for third-party code is a worse thing to own
// than a version requirement.

const vm = require('node:vm');

module.exports = async function requireEsmCapableNode() {
  if (typeof vm.SourceTextModule?.prototype.hasAsyncGraph === 'function') return;

  const flagMissing = typeof vm.SourceTextModule !== 'function';
  throw new Error(
    flagMissing
      ? 'Jest must run with NODE_OPTIONS=--experimental-vm-modules — Nest 12 is ' +
          'ESM-only and Jest cannot require() it without. `npm run test` sets it; ' +
          'a bare `npx jest` does not.\n'
      : `The API's tests need Node >= 24.9, and this is Node ${process.versions.node}.\n\n` +
          'Nest 12 is ESM-only; Jest can require() an ES module only from Node 24.9, ' +
          'so on anything older each spec that imports @nestjs/* fails with ' +
          '"Must use import to load ES Module" before it runs a single test.\n' +
          'The API itself runs on Node 22.12+; only the tests are affected.\n\n' +
          '    nvm use 24\n',
  );
};
