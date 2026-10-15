---
id: c3-245
c3-seal: f1172c4e9b5f41f08609c49c1503507785bd307497a6ab8267e077971a15a455
title: docs-site
type: component
category: feature
parent: c3-2
goal: Keep wiki/src/content/docs as the single place Kanna's user and operator docs are written, and publish it to two generated outputs, the Starlight site and the repository's GitHub Wiki, so neither output can drift from the source.
---

## Goal

Keep wiki/src/content/docs as the single place Kanna's user and operator docs are written, and publish it to two generated outputs, the Starlight site and the repository's GitHub Wiki, so neither output can drift from the source.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | Build-time only. wiki/ is its own package with its own node_modules; nothing in it ships in the kanna npm package or runs in the server process. |
| Consumers | Readers of kanna-wiki.lowbit.link and of the GitHub Wiki; README.md links into both; component facts list wiki pages as Derived Materials. |
| Boundary | Owns the docs source, the sidebar definition, the site build and the GitHub Wiki export. It does not own the facts the docs describe; each page derives from the component that owns the behaviour. |

## Purpose

Owns the docs pipeline. Pages are written once as Starlight markdown or MDX under wiki/src/content/docs; the sidebar is defined once in wiki/src/sidebar.mjs and read by both the Astro config and the GitHub Wiki export. The wiki-deploy workflow builds the site to GitHub Pages and, in a second job, converts the same pages to flat GitHub Wiki markdown and pushes them to the repository wiki. Non-goals: the GitHub Wiki is never edited by hand, and the CHANGELOG is linked rather than copied.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| adr-20261015-github-wiki-generated-mirror | adr | The GitHub Wiki is a generated mirror of wiki/ and is overwritten on every sync | Mandatory | The wiki repository must be bootstrapped once by creating any page in the web UI. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| wiki/src/content/docs | IN | Every doc carries title and description frontmatter; internal links are root-absolute slugs | A new MDX component needs a converter rule, otherwise the export fails and the convert test fails in CI. | wiki/scripts/github-wiki/convert.ts |
| GitHub Wiki pages | OUT | One page per doc named from its slug, plus Home, _Sidebar and _Footer; screenshots and diagrams copied beside them | The export wipes the wiki checkout before writing, so a deleted doc disappears from the wiki. | wiki/scripts/export-github-wiki.ts |
| wiki-deploy workflow | OUT | On a push to main touching wiki/, build and deploy the site, then export and push the wiki with the built-in token | The wiki job commits only when the export changed something. | .github/workflows/wiki-deploy.yml |
| Environment variable reference | OUT | reference/env-vars-data.ts is generated from the KANNA_ variables the source reads | Descriptions are curated in the extractor; a variable the scan cannot see is listed there explicitly. | wiki/scripts/extract-env-vars.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| The GitHub Wiki of cuongtranba/kanna | c3-245 Contract | None; it is regenerated in full from wiki/ on every sync | .github/workflows/wiki-deploy.yml |
