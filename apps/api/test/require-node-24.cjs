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
// 🔴 EVERY jest config in apps/api must name this file as its globalSetup —
// today two: the `jest` key in package.json (`npm run test`) and
// test/jest-e2e.json (`npm run test:e2e`). A config without it does not fail
// differently, it fails SILENTLY: the second one was left out at first, and
// `npm run test:e2e` produced exactly the raw error above, on the one path
// this file could not speak on. require-node-24.spec.ts in src/ reads the
// configs and refuses a jest config that does not name it.
//
// The capability predicate below is the one Jest itself tests, copied rather
// than paraphrased as a version number, so this cannot disagree with Jest — a
// Node 22 that one day backports `hasAsyncGraph` will simply start passing.
// The version number is used only to word the message, so that one run names
// EVERYTHING that is wrong instead of the flag first and the Node after.
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

const [major, minor] = process.versions.node.split('.').map(Number);
// Only to word the message: whether the version alone would already be wrong.
const nodeTooOld = major < 24 || (major === 24 && minor < 9);

module.exports = async function requireEsmCapableNode() {
  if (typeof vm.SourceTextModule?.prototype.hasAsyncGraph === 'function') return;

  const problems = [];
  if (nodeTooOld) {
    problems.push(
      `this is Node ${process.versions.node}, and Jest can require() an ES module only from Node 24.9  ->  nvm use 24`,
    );
  }
  if (typeof vm.SourceTextModule !== 'function') {
    problems.push(
      'Jest is not running with NODE_OPTIONS=--experimental-vm-modules  ->  use `npm run test` or `npm run test:e2e`, not a bare `npx jest`',
    );
  }
  if (problems.length === 0) {
    problems.push(
      'this Node has no vm.SourceTextModule.prototype.hasAsyncGraph, which Jest needs to require() an ES module',
    );
  }

  throw new Error(
    "The API's tests cannot load Nest here:\n" +
      problems.map((p) => `  - ${p}`).join('\n') +
      '\n\nNest 12 is ESM-only. Without this, each spec that imports @nestjs/* ' +
      'fails with "Must use import to load ES Module" before it runs a single test.\n' +
      'The API itself runs on Node 22.12+; only the tests are affected.\n',
  );
};
