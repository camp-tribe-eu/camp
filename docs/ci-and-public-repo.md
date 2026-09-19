# CI and the public repo

This repo is **public**. That was a deliberate choice, not an oversight: public
GitHub repos get unlimited free Actions minutes, private ones are capped
(2,000 min/month on the Free plan). A sibling project hit that cap and every
scheduled workflow (mailing, posting, metrics) silently stopped for weeks -
GitHub gives no notification when a run is blocked by billing, it just fails
in under 10 seconds.

Being public has one consequence that matters for how we write workflows:
**Actions logs on a public repo are readable by any logged-in GitHub account.**
That includes anything a workflow step prints to stdout/stderr, not just
files committed to the repo.

Rules that follow from this, not optional:

1. **Never print user data** - emails, names, trip contents, anything a real
   CampTribe user entered - to a workflow log. If a workflow ever needs to
   log something about a user for debugging, mask it first (e.g. `us**@***`),
   the same fix applied after the incident above.
2. **Secrets only via `Settings -> Secrets and variables -> Actions`**, never
   hardcoded, never echoed to a log step "just to check the value."
3. **Artifact and log retention is set to 7 days** (Settings -> Actions ->
   General), not the 90-day default. If something does leak into a log, it
   ages out on its own instead of sitting there for three months.
4. If a future workflow needs to touch real user data (not just build/test
   the app) - reconsider whether that job belongs in this public repo's
   Actions at all, versus running on a private machine/service instead.

`scripts/actions_state.py` checks whether Actions is currently blocked
(billing or otherwise) without spending any minutes itself, for when
scheduled automation gets added later.
