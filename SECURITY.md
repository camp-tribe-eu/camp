# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** This
repository is public, and an issue describing a flaw is a description of
how to exploit it, readable by anyone, from the moment you press submit.

Use one of these instead:

1. **GitHub private vulnerability reporting** — the *Report a
   vulnerability* button on the [Security tab](../../security). This is
   the preferred route: it is private, it threads, and it needs no email
   address from you.
2. **Email** — camp.tribe.eu@gmail.com, with `SECURITY` in the subject.

We will confirm receipt within **five working days** and tell you what we
intend to do. CampTribe is a small project: we would rather promise a
timeline we can keep than one that sounds impressive.

## What is in scope

This repository holds the public CampTribe site and its API:

- `apps/web` — the site
- `apps/api` — the API that serves campsite data
- `scripts/` — the OpenStreetMap pipeline and the checks that guard it

Findings we are particularly interested in:

- anything that discloses data we do not publish deliberately;
- anything that lets a third party act as us, or as a campsite owner;
- injection of any kind into a page — note that campsite names come from
  OpenStreetMap and are therefore untrusted input by design;
- a way around the security headers or the CORS allowlist.

## What is not a finding

- **Known transitive dependency advisories.** They are listed, with the
  reason each is accepted, in
  [`scripts/security/known-advisories.json`](scripts/security/known-advisories.json).
  A report that repeats that list adds nothing; a report showing one of
  them is actually reachable in our code is very welcome.
- **Denial of service by volume.** The site is static and sits behind a
  CDN. Please do not test this — you would be attacking a CDN, not us.
- **Missing headers on a preview or local build.** The production headers
  are generated at build time; see
  [`apps/web/scripts/security-headers.mjs`](apps/web/scripts/security-headers.mjs).

## Data we hold

The site stores no accounts, sets no cookies and uses no analytics. Every
page except the map contacts nothing outside our own origin; the map
additionally requests tiles from OpenFreeMap. Campsite data comes from
OpenStreetMap under ODbL.

## Automated checks

Every push runs, and must pass:

- a secret scan of the tracked tree, with a self-test that proves the
  scanner still catches a planted secret;
- a dependency check that fails on any advisory not already recorded with
  a reason;
- the structured-data, sitemap and indexing validators, each with a
  self-test where one is possible.

They are in [`scripts/security`](scripts/security) and
[`scripts/seo`](scripts/seo), and they are meant to be read.
