# The CMS that is not here yet

Directus lived here until **24 September 2026** and was removed on purpose.
This file is the whole of what is left, because a folder that vanishes
without a note reads as forgetfulness six months later, and the next person
to want a CMS should find a decision rather than an absence.

## Why it went

Measured on 24.09.2026, before removal:

| | |
|---|---|
| Dependency advisories in the whole repository | 77 |
| Of those, inside `apps/cms` | **49 — 64%** |
| Critical advisories in the whole repository | 1 |
| Where that critical lived | `apps/cms` → node-tar |

One application we barely had held two thirds of our security debt and the
only critical. And it was a tool **nobody had used yet**: it appeared in no
workflow, was deployed nowhere, and the public site reads from our own API,
never from Directus. One dependency we chose brought a tree of roughly 1 500
we did not.

The debt also grew by itself. Every week a new advisory arrived and was
answered in `scripts/security/known-advisories.json` with a truthful
explanation of why it could not reach us. Dozens of those explanations, all
about software nobody had opened. Meanwhile the honest answer to "how many
vulnerabilities do you have" was 77 rather than 28 — and nobody reads forty
footnotes before forming an impression.

Upgrading did not solve it: Directus 12.4.1 takes this workspace from 49
advisories to 30, but `@directus/api` pins `tar` exactly, so the critical
survives. `npm overrides` does nothing in this tree either — npm 11.16.0
never writes the field into `package-lock.json`, verified twice.

## What was deliberately NOT removed

**The database columns and their migration.** `reviews.reviewed_by_directus_id`
and `photo_submissions.reviewed_by_directus_id` are untouched, and migration
`1790002922176-ContentCollections` still runs. The schema is ready for
moderators; only the tool is gone.

That is the point of doing it this way: nothing about the data model has been
decided by this removal, so bringing a CMS back is an installation, not a
migration.

## Bringing it back

The day there is a first moderator (CAMP-62):

1. `git show 4de5a05:apps/cms/package.json > apps/cms/package.json` — that
   commit is the last one where this app was complete. `configure.mjs`,
   `verify-permissions.mjs` and `.env.example` are in the same tree.
2. `npm install`
3. `npm run bootstrap:cms`, then `npm run dev:cms` — those two scripts were
   removed from the root `package.json` and are in that commit too.
4. Re-read the advisories before trusting any of it. The version that was
   here is a year older by now, and the note in `known-advisories.json`
   about why none of it could reach us **stops being true the moment
   somebody logs in**.

Step 4 is the one worth reading twice. Every "this cannot reach us" in that
file rested on nobody running Directus.

## If you would rather not

Directus was chosen before there was anything to moderate. Nothing about the
schema requires it — the columns hold a UUID, not a Directus concept. When
the need is real, pick the tool for the need that exists then.

Related: CAMP-106 (this decision), CAMP-62 (moderation), CAMP-89, CAMP-96.
