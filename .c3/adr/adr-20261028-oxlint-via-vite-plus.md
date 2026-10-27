---
id: adr-20261028-oxlint-via-vite-plus
c3-seal: 900b4f311deb54e7caa16a36efb254b7968b65a7893ea9c09be3bfc9135ae235
title: oxlint-via-vite-plus
type: adr
goal: Record the decision to lint and type-check Kanna with Oxlint through Vite+ (`vp lint`, `vp check`) instead of ESLint plus a separate TypeScript 7 `tsc`, keeping every existing gate's effective behaviour. This is the Oxlint half that adr-20261027-adopt-vite-plus-vitest-under-bun deferred; no formatter is adopted.
status: done
date: "2026-10-28"
---

## Goal

Record the decision to lint and type-check Kanna with Oxlint through Vite+ (`vp lint`, `vp check`) instead of ESLint plus a separate TypeScript 7 `tsc`, keeping every existing gate's effective behaviour. This is the Oxlint half that adr-20261027-adopt-vite-plus-vitest-under-bun deferred; no formatter is adopted.

## Context

`eslint.config.js` was 609 lines carrying the side-effect seal, the design gate, the type-strictness bans, the pending-state gate and four complexity ceilings pinned by the architecture budget. `bun run lint` took about 73 seconds, and `bun run typecheck` ran the TS7 `tsc` installed beside TS6 only because typescript-eslint needed the old JS API. Vite+ already bundles Oxlint 1.89.0 and tsgolint, the gates rely on `no-restricted-syntax` AST selectors that Oxlint does not implement natively, and the native React Compiler rules are reserved names that cannot be loaded as a JS plugin.

## Decision

`lint.config.ts` is pure data typed with `OxlintConfig`, handed to `vite.config.ts` as `lint:`, with `check: { fmt: false }`. All default categories are off and an explicit rule list is on. `jsPlugins` loads `oxlint-plugin-eslint` (pinned to the bundled Oxlint) as `eslint-js`, which runs every existing selector unchanged and also runs the four complexity ceilings, `no-useless-return`, `no-unsafe-optional-chaining` and `prefer-object-spread`, because the native versions diverge from ESLint on this tree. ESLint `ignores` became `excludeFiles` overrides that restate the full effective rule options. Type checking moves to `vp check --no-lint`, which matched `tsc --noEmit` on a seeded tree for `src/`, `scripts/`, `vite.config.ts` and `lint.config.ts`. A selector bans an arrow-body `void expr` in client code because tsgolint, unlike typescript-eslint, does not flag it. `typescript@6.0.3` stays for its JS API; `typescript-7`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks` and `globals` are removed.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - named only to complete the top-down descent; the system goal and container boundaries do not change | N.A - no system-level fact is edited | N.A - no delta |
| c3-2 | container | N.A - named only to complete the top-down descent for c3-236; the server container's responsibilities do not change | N.A - no container-level fact is edited | N.A - no delta |
| c3-236 | component | The budget's complexity-ceiling pins and the tightness prover read the ceilings from `lint.config.ts` instead of `eslint.config.js`, and the pin table is renamed `LINT_LIMIT_PINS` | c3-236#n13772@v1:sha256:f7a0882f22dfd31662ebbdc15f54a42bb0c6705245d58cda779f43130e9aa56e "Each pin must equal the ceiling lint.config.ts configures for that rule." | The four breach kinds and their semantics are unchanged; the component fact, its eval binding and the code map name the new files |

## Verification

| Check | Result |
| --- | --- |
| `bun run lint` and `bun run typecheck` | Both exit 0 on the tree; lint wall-clock drops from about 73 seconds to about 10 |
| `bun run lint:limits` | Reports all four ceilings tight, and fails with a slack message when a pin is raised by one |
| `bun run test src/ops/testing/pending-state-gate.test.ts` | Four lint verdicts on `void`, an async JSX handler, a silent catch and `runPendingAction` come from Oxlint |
| `bun run check:arch` | `LINT_LIMIT_PINS` equals every configured ceiling |
