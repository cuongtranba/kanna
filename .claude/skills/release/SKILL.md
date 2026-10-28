---
name: release
description: Explains how a Kanna version reaches npm through release-please — conventional commits decide the bump, merging the release PR publishes — and how to keep a commit from being silently dropped. Use whenever the user says "cut a release", "ship a new version", "publish to npm", "bump the version", "tag a release", "release 1.2.3", asks what the next version will be or whether a change is a patch, minor, or major bump, asks why a change is missing from CHANGELOG.md, or reports a failed npm publish.
---

# Releasing Kanna

Nobody bumps `package.json` or runs `npm publish` by hand.

1. Every push to `main` runs `.github/workflows/release-please.yml`, which keeps one
   release PR open (`chore(main): release X.Y.Z`) holding the next version and the
   `CHANGELOG.md` entry.
2. Merging that PR tags `vX.Y.Z`, creates the GitHub release, and runs `publish`
   (`npm publish --provenance` of `@cuongtran001/kanna`) plus the beacon binary jobs.

So "cut a release" means: confirm the release PR's version and notes, then merge it
(`gh pr list --repo cuongtranba/kanna --search "chore(main): release"`).

## The commit messages decide the version

release-please reads the Conventional Commits since the last tag: `fix` is a patch,
`feat` a minor, `!` or a `BREAKING CHANGE:` footer a major. To force a version, land
a commit with a `Release-As: X.Y.Z` footer.

**A commit the parser cannot read is dropped silently** — from the changelog and
from the version calculation — and the workflow stays green. The usual trigger is a
body line that STARTS with `word(` and nests another `(` before the closing `)`,
such as a line beginning `calc(2 * var(--x))`; a word or a bullet in front of it
fixes it. A squash merge lands the PR title as the subject and the commits as the
body, so both count. Check before pushing or merging:

```bash
bun run check:commits --range origin/main..HEAD
```

The same parser (`src/ops/release/commit-message.ts`) runs in `.githooks/commit-msg`
(`bun run setup:hooks`) and in the PR-only CI job `commit-messages`.

## A failed publish

Re-running the workflow does not help: release-please sees the release exists and
skips `publish`. Publish the existing tag instead, which keeps the provenance
signature: `gh workflow run release-please.yml --repo cuongtranba/kanna -f tag=vX.Y.Z`.
An `E404 Not Found` from `npm publish` usually means `NPM_TOKEN` (90-day cap)
expired. Details: `wiki/src/content/docs/guides/contributing/releasing.md`.
