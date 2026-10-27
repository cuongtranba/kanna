---
id: adr-20261027-adopt-vite-plus-vitest-under-bun
c3-seal: 382f6af1a9f61e54ff61c5d0af205e22ebf46f2cad5f5c4a954fd9dc5ab363dc
title: adopt-vite-plus-vitest-under-bun
type: adr
goal: Record the decision to run Kanna's test suite on Vitest through the Vite+ toolchain (`vp test`) while keeping Bun as the runtime, replacing `bun test` (bun:test) as the single test runner. ESLint stays for now and moves to Oxlint in a later change; no formatter is adopted.
status: done
date: "2026-10-27"
---

## Goal

Record the decision to run Kanna's test suite on Vitest through the Vite+ toolchain (`vp test`) while keeping Bun as the runtime, replacing `bun test` (bun:test) as the single test runner. ESLint stays for now and moves to Oxlint in a later change; no formatter is adopted.

## Context

The suite was 738 colocated files on bun:test, run as one process by `bun test --conditions production --timeout 30000` with `scripts/test-preload.ts` wired in through `bunfig.toml`. Phase 1 (build: run client dev and build through Vite+) put `vite-plus` in the repo and aliased `vite` to `@voidzero-dev/vite-plus-core`. Vite+ bundles Vitest, so the test runner can share the same config file as the client build. The pressure was the runner's single-process model: `mock.module` rewrote a process-wide registry that outlived its file and blocked the v1.58.0 publish, a leaked React root blamed an unrelated file, and the suite took about 290 seconds serially. The constraint is that server code uses `bun:sqlite`, `Bun.serve`, `Bun.Terminal` and `Bun.spawn`, so the runner cannot move to Node.

## Decision

Run Vitest 5 inside the Bun runtime: `bun run test` is `bun --bun vp test run`, configured by the `test` block of `vite.config.ts`, and test files import from "vite-plus/test". Bun stays the runtime for the server, scripts and tests. The `production` export condition (Lexical 0.45's dev ESM build has a circular-dependency TDZ) is applied only when Vite's mode is test, so the client build is byte-identical. Plugin tests `import()` blob URLs, which only load when `server.deps.external` lists `/^blob:/`. `import.meta.dir` is undefined under Vitest's module runner, so production and test code use `import.meta.dirname`, which Bun supports natively. The default `sequence.hooks` of stack is kept because the React leak sweep registered in the setup file must run after every hook a test file registers. `scripts/test-preload.ts` becomes `scripts/test-setup.ts` and `bunfig.toml` is deleted. The module-mock policy stays: injection over mocking, and the shrink-only `LEGACY_MODULE_MOCKS` guard now matches `vi.mock` and `vi.doMock`. Vitest isolates each file in its own worker, so the cross-file registry poisoning that motivated the ban is historical. Oxlint replaces ESLint in a later PR, and no formatter is adopted.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - named only to complete the top-down descent; the system goal and container boundaries do not change | N.A - no system-level fact is edited | N.A - no delta |
| c3-2 | container | N.A - named only to complete the top-down descent for c3-236; the server container's responsibilities do not change | N.A - no container-level fact is edited | N.A - no delta |
| c3-236 | component | The architecture budget gate is `bun run check:arch`, which now runs its three suites through `vp test` under Bun instead of `bun test`, and its Runtime and Change Safety rows name the old runner | c3-236#n13749@v1:sha256:4f7fbe22a15f8dbccaa2f69079e8c6d4b8489e27ba642ee081fe1ab614fcd0aa "Runtime" | The gate stays a colocated test (rule-colocated-bun-test); the two Change Safety verification commands are updated to `bun run test` |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-side-effect-adapter | N.A - c3-236 cites it, but the budget scan adapter and the test files stay as they are | N.A - no IO file is added or moved | N.A - no change |
| ref-strong-typing | N.A - c3-236 cites it, but no type or schema changes | N.A - no type is touched | N.A - no change |
| ref-colocated-bun-test | It records the single-runner choice, which changes from bun test to Vitest under Bun | ref-colocated-bun-test#n14967@v1:sha256:2d945da53a0cda798816739c560477c489132b80b73e2fa769466f06cd0741b0 "Vitest 5 through Vite+" | update-ref |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | It mandates bun:test imports and bans vitest, both of which this decision reverses; the colocation and naming promises are unchanged | rule-colocated-bun-test#n15304@v1:sha256:7e483eae211e03d078cf7184e86b152425a936724793ca87a332be6eaf633946 "All test files must live in the same directory" | update-rule |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep `bun test` and only add Vite+ for the client build | Phase 1 already did that; it leaves two configs, a single-process runner whose module mocks poisoned unrelated suites (the v1.58.0 publish block) and a roughly 290 second serial suite |
| Run Vitest under Node (`vp test` without `--bun`) | Server code imports `bun:sqlite` and uses `Bun.serve`, `Bun.Terminal` and `Bun.spawn`, none of which exist under Node, so most server suites could not load |
| Scope the `production` condition globally in `resolve.conditions` | It would change which Lexical build the client bundle ships; `bun run check:bundle` must keep reporting 294,659 gzip bytes, so the condition is gated on test mode |
| Replace `import.meta.dir` with a helper that handles both | `import.meta.dirname` is native to Bun and Node and is a one-token swap; a helper would be a new abstraction for a value the platform already provides |

## Verification

| Check | Result |
| --- | --- |
| `bun --bun vp test run --reporter=junit --outputFile.junit=/tmp/vitest-junit.xml`, compared per file against the `bun test` JUnit report | Every file has the same test count; the only differences are one added loop-template test and two skipped live tests that Bun did not count |
| A scratch test that mounts a root and never unmounts it | Fails from the `afterEach` sweep in `scripts/test-setup.ts`, naming the leaked node |
| `KANNA_WATCH_LEAK=1 bun run test src/server/workflow-watch-io.adapter.test.ts` | Prints `[watch-leak] detector armed` on stderr |
| `bun run build` then `bun run check:bundle` | Client entry stays at 294,659 gzip bytes, same as before the migration |
| `bun run check:arch` | Passes under the new runner |
| `c3x check` | Exits ok with no new issues |
