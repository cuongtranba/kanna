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

## The npm token expires

`NPM_TOKEN` is an npm granular access token, which npm caps at **90 days**. When
it expires, `npm publish` fails with a misleading `E404 Not Found` rather than an
authentication error. Create a new token on npmjs.com (all packages, read and
write), then:

```bash
gh secret set NPM_TOKEN
```
