---
title: Releasing
description: How release-please cuts a version and publishes it to npm, why commit messages must parse, and how to recover a failed publish.
---

Releases are automated. Every merge to `main` runs
[release-please](https://github.com/cuongtranba/kanna/blob/main/.github/workflows/release-please.yml),
which keeps a release pull request open with the next version and changelog.
Merging that pull request tags the version, creates the GitHub release, and
publishes `@cuongtran001/kanna` to npm with a provenance attestation.

## Commit messages decide the version

The next version is computed from the
[Conventional Commit](https://www.conventionalcommits.org/) messages since the
last tag: `feat` is a minor bump, `fix` a patch, and a breaking change a major.

A commit release-please **cannot parse is dropped**, from the changelog and from
the version calculation, and the workflow still passes. The common trigger is a
body line that starts with `word(`, which the parser reads as a new header, for
example a line beginning with `calc(2 * var(--x))`. Indent it with a bullet or
put a word in front of it.

The `commit-msg` hook (`bun run setup:hooks`) and the `commit-messages` CI job
run the same parser release-please uses, over every commit in a pull request and
over its title. Check a range by hand with:

```bash
bun run check:commits --range origin/main..HEAD
```

## Recovering a failed publish

If the `publish` job fails, the version is tagged on GitHub but missing from npm.
**Re-running the workflow does not fix it**: release-please reports that no
release was created, so `publish` is skipped. Publish the existing tag instead:

```bash
gh workflow run release-please.yml -f tag=v1.32.0
```

That rebuilds and publishes from the tag through CI, so the package keeps its
provenance signature. A local `npm publish` would not.

## How the publish authenticates

The `publish` job uses npm **Trusted Publishing** (OIDC), not a stored token.
On npmjs.com, `@cuongtran001/kanna` trusts GitHub Actions runs of
`cuongtranba/kanna` from the workflow file `release-please.yml`; the job's
`id-token: write` permission lets npm (11.5.1 or newer) swap the run's OIDC token
for a short-lived publish token. Nothing expires, and no `NPM_TOKEN` secret is read.

An `E404 Not Found` on `PUT https://registry.npmjs.org/@cuongtran001%2fkanna`
means npm did not accept the run as the trusted publisher. Check the package's
Trusted Publisher settings on npmjs.com (owner, repository and workflow file name
must match exactly), and check that the publish ran from `release-please.yml`.
Then publish the tag again as above.
