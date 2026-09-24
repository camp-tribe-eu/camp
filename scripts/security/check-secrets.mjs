#!/usr/bin/env node
// Refuse to carry a secret in a public repository.
//
// 🔴 This repo is public — that is a deliberate choice, for unlimited
// Actions minutes — and the owner has had a real leak before. Every
// guard elsewhere protects readers; this one protects him. A token that
// reaches a public commit is public the moment it is pushed, whether or
// not anyone notices, and rewriting history does not un-publish it.
//
//   node scripts/security/check-secrets.mjs             # scan
//   node scripts/security/check-secrets.mjs --self-test # prove it bites
//
// 🔴 It has a self-test for the reason every check here does: a scanner
// whose patterns have quietly stopped matching reports a clean tree
// forever, which is indistinguishable from safety and is worse than
// having no scanner, because it is trusted.
//
// This is a floor, not a ceiling. GitHub's own secret scanning with
// push protection is free on public repositories and blocks the push
// itself; this runs after the commit exists. Both, not either.

import { execFileSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Each rule is a shape that is a credential wherever it appears, not a
 * word that might be one. "password" in a comment is not a finding;
 * `AKIA…` is.
 */
const RULES = [
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub personal token', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'GitHub OAuth/app token', re: /\bgh[osru]_[A-Za-z0-9]{36}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe secret key', re: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'JSON web token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: 'database URL with a password',
    // 🔴 The throwaway CI credential is excluded by value, not by
    // guessing: it is `postgres:postgres@localhost`, it is printed in
    // the workflow on purpose, and it protects nothing.
    //
    // 🔴 And a host that cannot exist, by the same standard.
    //
    // import-release.mjs tests its connection-string builder against
    // URLs that must carry a password, because quoting the password is
    // the thing under test — and every one of them tripped this rule.
    // The answer is not to stop scanning that file and not to let the
    // pattern rot: it is that RFC 2606 and RFC 6761 reserve
    // example.com/net/org and the .test, .example, .invalid and
    // .localhost TLDs so that documentation can name a host which is
    // guaranteed never to resolve. A credential pointed at one of those
    // reaches nothing, whoever reads it.
    //
    // Narrow on purpose. A real provider's domain — db.neon.tech,
    // rds.amazonaws.com, and the .eu host in the self-test below — still
    // trips the rule, which is the whole point.
    re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/,
    ignore:
      /postgres:postgres@localhost|@[\w.-]*(?:example\.(?:com|net|org)|\.(?:test|example|invalid|localhost))(?:[:/?'"\s]|$)/,
  },
  {
    name: 'assigned credential',
    // KEY = "long-opaque-value" in any config or code.
    re: /\b(?:api[_-]?key|secret|token|passwd|password|access[_-]?key)\b\s*[:=]\s*["'][A-Za-z0-9/+_-]{20,}["']/i,
    // Placeholders are the point of an example file.
    ignore: /(your|example|changeme|placeholder|dummy|xxx+|<[^>]+>|\.\.\.)/i,
  },
];

/** Files that exist to SHOW the shape of a secret. */
const ALLOW_PATHS = [/\.env\.example$/, /scripts\/security\/check-secrets\.mjs$/];

function tracked() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function scanText(text, label, findings) {
  for (const rule of RULES) {
    for (const [i, line] of text.split('\n').entries()) {
      const hit = rule.re.exec(line);
      if (!hit) continue;
      if (rule.ignore && rule.ignore.test(line)) continue;
      findings.push({
        label,
        line: i + 1,
        rule: rule.name,
        // Never print the value itself: this output goes to a public
        // Actions log.
        preview: `${hit[0].slice(0, 6)}…(${hit[0].length} chars)`,
      });
    }
  }
}

if (process.argv.includes('--self-test')) {
  const planted = [
    // AWS keys are AKIA plus exactly 16 characters. The first version
    // of this line had 17 and the self-test failed — which is the
    // self-test doing its job on its own bait.
    'aws = "AKIAIOSFODNN7EXAMPLE"',
    'gh = "ghp_0123456789abcdefghijklmnopqrstuvwxyz"',
    'slack: xoxb-123456789012-abcdefghijkl',
    'DATABASE_URL=postgres://camp:s3cr3tpassword@db.example.eu:5432/camp',
    // 🔴 The reserved-host exemption must not become "anything with the
    // word example in it". A real provider is still a real provider.
    "conninfo('postgres://u:s3cr3t@db.neon.tech/app')",
    "conninfo('postgres://u:s3cr3t@example-db.camptribe.eu/app')",
    'api_key = "aZ9bY8cX7dW6eV5fU4gT3hS2iR1j"',
    '-----BEGIN RSA PRIVATE KEY-----',
  ];
  let ok = true;
  for (const line of planted) {
    const f = [];
    scanText(line, 'self-test', f);
    if (!f.length) {
      console.error(`✗ not detected: ${line.slice(0, 40)}…`);
      ok = false;
    }
  }
  // And the things that must NOT fire, or the check gets switched off.
  const benign = [
    'DATABASE_URL=postgres://postgres:postgres@localhost:5432/camptribe_test',
    'API_KEY="your-key-here"',
    '// the password is never logged',
    'const token = process.env.CF_API_TOKEN;',
    // RFC 2606 / RFC 6761: hosts guaranteed never to resolve, which is
    // why documentation and test fixtures are allowed to use them.
    "conninfo('postgres://u:p@db.example.invalid/app?sslmode=require')",
    "conninfo('postgres://u:two%20words@h.invalid/app')",
    "conninfo('postgres://u:p@db.example.com/app')",
    "conninfo('postgres://u:p@localhost.localhost/app')",
  ];
  for (const line of benign) {
    const f = [];
    scanText(line, 'self-test', f);
    if (f.length) {
      console.error(`✗ false positive on: ${line}`);
      ok = false;
    }
  }
  console.log(
    ok
      ? '✓ self-test passed: every planted secret is caught and nothing benign is'
      : '\n✗ self-test FAILED — the scanner is not scanning',
  );
  process.exit(ok ? 0 : 1);
}

const findings = [];
let scanned = 0;
for (const rel of tracked()) {
  if (ALLOW_PATHS.some((re) => re.test(rel))) continue;
  const abs = path.join(ROOT, rel);

  // 🔴 One file descriptor, opened once, then measured and read through
  // that same descriptor.
  //
  // The first version called statSync(path) and then readFileSync(path):
  // two lookups of the same name, with a gap in between. CodeQL flagged
  // it as a file-system race, and it is right — whatever the second call
  // opens need not be what the first one measured. In a scanner whose
  // whole job is to decide whether a file is safe, checking one file and
  // reading another is precisely the wrong failure.
  let fd;
  let text;
  try {
    fd = openSync(abs, 'r');
    const st = fstatSync(fd);
    // Binaries and large data files are not where a token hides, and
    // reading them costs more than it finds.
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
    text = readFileSync(fd, 'utf8');
  } catch {
    continue;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (text.includes('\0')) continue;
  scanned++;
  scanText(text, rel, findings);
}

console.log(`scanned ${scanned} tracked files`);
if (findings.length) {
  console.error(`\n🔴 ${findings.length} possible secret(s):`);
  for (const f of findings) {
    console.error(`   ${f.label}:${f.line}  ${f.rule}  ${f.preview}`);
  }
  console.error(
    '\nIf one of these is real: rotate it FIRST, then remove it. A secret in\n' +
      'a public repository is public from the moment it is pushed.',
  );
  process.exit(1);
}
console.log('✓ no secrets in tracked files');
