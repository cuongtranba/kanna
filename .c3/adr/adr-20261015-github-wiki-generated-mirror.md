---
id: adr-20261015-github-wiki-generated-mirror
c3-seal: bd3787a38a4585b63b178e106f4ea3910b98335a6f364e2c187c529eb2167b1d
title: github-wiki-generated-mirror
type: adr
goal: Publish wiki/src/content/docs to the repository GitHub Wiki automatically, so wiki/ stays the single source of truth for Kanna's docs and the GitHub Wiki can never be edited into disagreement with it.
status: done
date: "2026-10-15"
---

## Goal

Publish wiki/src/content/docs to the repository GitHub Wiki automatically, so wiki/ stays the single source of truth for Kanna's docs and the GitHub Wiki can never be edited into disagreement with it.

## Context

Kanna's docs are written as Starlight markdown and MDX under wiki/src/content/docs and deployed to kanna-wiki.lowbit.link by the wiki-deploy workflow. The repository has the GitHub Wiki feature enabled but no pages. Readers who land on the repository look for docs in the Wiki tab, and a hand-maintained second copy would drift from the site within days, which is the failure this repo's docs rules exist to prevent. The source uses constructs a GitHub Wiki cannot render: MDX imports, Screenshot, Diagram, EnvVarTable and splash-page components, Starlight asides, and root-absolute links whose paths do not exist on the wiki. The sidebar was an inline object in astro.config.mjs, readable only by Astro.

## Decision

The GitHub Wiki is a build output, never a source. A converter in wiki/scripts/github-wiki turns each doc into one flat page named from its slug (features/cron-jobs becomes Features-Cron-Jobs, which keeps the three overview pages and the two beacons pages distinct), rewrites internal links to those names, turns asides into GitHub alerts, turns Screenshot and Diagram into images copied into the wiki repository, and renders EnvVarTable as a markdown table. The sidebar moves to wiki/src/sidebar.mjs so the site and the wiki read one definition; the export emits _Sidebar.md from it and a _Footer.md that says where to edit. A second job in wiki-deploy.yml runs the export on every push to main that touches wiki/ and pushes to the wiki repository with the built-in token, wiping the checkout first so deleted docs disappear. The export fails on any unsupported component or unresolved link, and a test converts the real docs tree, so a doc the mirror cannot carry fails CI instead of publishing broken. The CHANGELOG is linked, not copied.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-245 | component | New docs-site component owning the docs source, the shared sidebar, the site build and the GitHub Wiki export | c3-245#n14841@v1:sha256:bcb1555abbe1cbf0a5a5f689c02282cb147aad894e7a68f7af25dab0dcfbb378 | Its Governance cites this ADR |
| c3-244 | component | Push notifications were unmodelled; added in the same C3 sync so every server feature has an owning fact | c3-244#n14728@v1:sha256:901c4a892227e4a1785bca3274ff2d603e3bdd0cb3f17eb5a106e4f5467d4273 | Event-sourcing, side-effect-adapter and local-first refs reviewed in its Governance |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Maintain the GitHub Wiki by hand | Two sources drift; the site and the wiki would disagree within one release |
| Point the Wiki tab at the site and leave the wiki empty | The user asked for the GitHub Wiki to carry the docs |
| Mirror Starlight's built HTML | GitHub Wiki pages are markdown; HTML loses the sidebar and link rewriting |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The wiki repository does not exist until a page is created by hand | The job fails with an explicit error naming the one-time bootstrap step | First workflow run after merge |
| Someone edits the GitHub Wiki directly | _Footer.md on every page says edits are overwritten; the next sync replaces them | Read any wiki page footer |
| A new doc uses a component the converter does not know | The export throws and the convert test fails | bun run test wiki/scripts/github-wiki |

## Verification

| Check | Result |
| --- | --- |
| Convert test over the real docs tree | Recorded in the pull request |
| Site build with the extracted sidebar | Recorded in the pull request |
