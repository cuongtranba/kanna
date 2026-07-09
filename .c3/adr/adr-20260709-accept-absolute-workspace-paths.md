---
id: adr-20260709-accept-absolute-workspace-paths
c3-seal: b536d97f4c84a6c17afafcca3144d15bd2ba7ce397c21e0c6e9b31e77d5b67f8
title: accept-absolute-workspace-paths
type: adr
goal: Broaden the `preview_file` and `offer_download` MCP tool path argument to accept an absolute filesystem path in addition to a project-relative one, so a file that lives outside the chat's project root — e.g. a spec committed to a sibling git worktree (`../OpenMontage-wire-executor/docs/...`) — can be surfaced in the Kanna chat UI instead of failing the "outside project root" guard.
status: proposed
date: "2026-07-09"
---

## Goal

Broaden the `preview_file` and `offer_download` MCP tool path argument to accept an absolute filesystem path in addition to a project-relative one, so a file that lives outside the chat's project root — e.g. a spec committed to a sibling git worktree (`../OpenMontage-wire-executor/docs/...`) — can be surfaced in the Kanna chat UI instead of failing the "outside project root" guard.

## Context

`resolveWorkspaceFile` / `resolveOfferDownload` in `src/server/kanna-mcp.ts` normalized the caller's path and rejected anything that resolved outside `args.localPath` (the chat's project root), including every absolute path and every `..` escape. Users who work across sibling git worktrees (the project mandates worktree-per-task) committed specs into a sibling worktree and then could not `preview_file` them: the tool returned an empty payload / "Invalid project file path". Meanwhile the file-serving endpoint `/api/local-file` (`server.ts:866`) already serves ANY absolute real file with zero project-root confinement — so the MCP-tool guard was strictly tighter than the serve layer it feeds, and the intent ("files written in a worktree chat resolve", already in the c3-226 contract) was blocked for sibling worktrees. Affected topology: c3-226 (kanna-mcp-host) owns both resolvers; c3-303 (file-preview UI) consumes the result unchanged.

## Decision

Accept absolute paths. Extract a shared `resolveWorkspacePath(localPath, rawPath)` helper that branches: an absolute path (`isAbsoluteFilePath`) is used verbatim (`path.resolve`, no root confinement) and served through `/api/local-file`; a relative path keeps the existing normalize + project-root confinement and still rejects `..` traversal and post-normalize-absolute. This matches what `/api/local-file` already serves (so no new attack surface is opened at the HTTP layer), reuses the existing `buildLocalFileContentUrl` / `buildContentUrlForFilePath` helpers, and requires no new IO or git dependency. `offer_download` uses the project-scoped URL for relative paths and `/api/local-file` for absolute; `preview_file` uses `/api/local-file` for both.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-226 | component | Owns resolveWorkspaceFile / resolveOfferDownload / the new shared resolveWorkspacePath helper and both tool contracts | Contract row for preview_file updated to state relative-OR-absolute path acceptance |
| c3-303 | component | Consumes the {kind:"file_preview"} result | N.A - result shape unchanged; contentUrl already supported both /api/local-file and project-scoped forms |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-local-first-data | Path-deny defaults block leaving project root; this ADR relaxes that for absolute paths | review — absolute serve already unconfined at /api/local-file; no new HTTP surface |
| ref-strong-typing | New helper crosses the MCP boundary | comply — resolveWorkspacePath returns a named discriminated union, no any/unknown |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Helper return type at the host boundary | comply — typed discriminated union |
| rule-colocated-bun-test | Both resolvers have colocated tests | comply — kanna-mcp.test.ts updated: absolute-path accept cases replace the old reject cases; .. reject cases kept |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Resolver | Extract resolveWorkspacePath helper; branch absolute vs relative | src/server/kanna-mcp.ts |
| offer_download | Route absolute → buildLocalFileContentUrl, relative → project URL | src/server/kanna-mcp.ts |
| Tool descriptions | preview_file + offer_download path arg docs note absolute paths | src/server/kanna-mcp.ts |
| Tests | Replace "rejects absolute paths" with "accepts absolute paths (routes to /api/local-file)" for both resolvers; keep .. reject | src/server/kanna-mcp.test.ts |
| Doc | Enrich c3-226 preview_file contract row | .c3 c3-226 Contract |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no CLI change | N.A - this ADR changes application code + a component contract row only, no c3x CLI/validator/schema surface | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/kanna-mcp.test.ts | Asserts absolute paths resolve to /api/local-file and .. traversal still rejected | 42 tests pass |
| bunx eslint src/server/kanna-mcp.ts | Side-effect seal + strong-typing lint clean | max-warnings=0 pass |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Scope to git worktrees (git worktree list) | Adds git subprocess IO (needs a .adapter.ts per side-effect seal) + complexity, for a fence that /api/local-file does not itself enforce — theater |
| Allow any resolvable file incl relative .. escapes | Loosest; removes the relative-path intent guard with no benefit — callers can already pass an absolute path explicitly |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Model passes an unintended absolute path exposing an out-of-root file | /api/local-file already serves any absolute file; no new exposure vs status quo; read-only preview, no write | bun test src/server/kanna-mcp.test.ts |
| Relative-path confinement accidentally dropped | Relative branch keeps normalize + root check + .. reject; covered by retained reject tests | bun test src/server/kanna-mcp.test.ts (traversal reject cases) |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/kanna-mcp.test.ts | 42 pass / 0 fail |
| bunx eslint src/server/kanna-mcp.ts src/server/kanna-mcp.test.ts --max-warnings=0 | clean |
