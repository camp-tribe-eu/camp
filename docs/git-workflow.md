# How we branch and merge

We use **GitHub flow**. Not git-flow.

## Why this one, and not the famous one

The model most people mean by "the official git flow" is Vincent
Driessen's *A successful Git branching model* (2010) — `develop`,
`release/*`, `hotfix/*`. Its own author added a note to it on 5 March
2020:

> "Web apps are typically continuously delivered, not rolled back, and
> you don't have to support multiple versions of the software running in
> the wild. This is not the class of software that I had in mind when I
> wrote the blog post 10 years ago. If your team is doing continuous
> delivery of software, I would suggest to adopt a much simpler workflow
> (like GitHub flow) instead of trying to shoehorn git-flow into your
> team."

CampTribe is exactly that: one version, continuously delivered, nothing
to roll back to. `develop` and `release/*` branches would be ceremony
that buys us nothing and gives the branch-drift problem below somewhere
to hide.

## The rules

1. **`main` is the only long-lived branch, and it is always releasable.**
   Everything else is temporary.

2. **Start by pulling.** Before the first commit of any task:

   ```bash
   git checkout main && git pull
   git checkout -b camp-32-map-markers
   ```

   One branch per Jira card, named after it. Short and descriptive.

3. **One branch per unrelated set of changes.** If a task turns out to
   contain two, split it — a delay in one should not hold the other.

4. **Push early.** A branch that exists only on one machine is not backed
   up, is invisible, and CI has not seen it.

5. **Open the pull request early**, as a draft if the work is not done.
   CI runs on it, and the change is reviewable while it is still small
   enough to review.

6. **Merge when CI is green, then delete the branch.** GitHub keeps the
   pull request and its history; the branch itself has no further job.

7. 🔴 **Do not let a branch drift.** If `main` has moved, merge it in the
   same day:

   ```bash
   git fetch origin && git merge origin/main
   ```

## The failure this was written after

On 22 September 2026 one branch, `camp-27-89-data-core`, carried **28
commits over several days**: the campsite dataset, the map, the error
pages, a Next major upgrade, the security headers, every new guard.
`main` never moved. Every check was green — on the branch.

What that actually cost:

- **CodeQL and Dependabot scan the default branch.** Both were switched
  on that day, both reported on `main`, and neither had seen a line of
  the work. The security tab was confidently describing a repository
  that had not existed for days.
- **`SECURITY.md` and `dependabot.yml` are read from the default
  branch**, so both were inert.
- **Dependabot opened a pull request** to bump Next to the version the
  branch had already been on for hours.
- **The merge was luck.** It happened to be a fast-forward. Twenty-eight
  commits of divergence is exactly where a merge stops being a
  formality, and nobody knew which it would be until they tried.

## The guard

`scripts/ci/check-branch-drift.mjs` runs on every push and fails when a
branch is more than **20 commits ahead of `main`**, with the reasoning
above in the failure message. Being *behind* main prints a warning
rather than failing — falling behind is normal, staying behind is not.

It has a self-test, like every other check here:

```bash
node scripts/ci/check-branch-drift.mjs --self-test
```

A rule nobody checks is a rule that rots. This one cost us a day to
learn, so it is checked.
