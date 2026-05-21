---
id: adr-20260521-c3-docs-codemap-sync
c3-seal: 35bccd579e7e317b92058feeb5a084907e0f7592fae93cbf22a7dddbb04eaaa1
title: c3-docs-codemap-sync
type: adr
goal: |-
    Bring the `.c3/` topology back into agreement with the current `src/` tree.
    Add two missing server feature components (`c3-226 kanna-mcp-host` and
    `c3-227 auto-continue`) and extend code-map patterns on existing client,
    server, and shared components so `c3x lookup` resolves every shipping
    source file. Establish `_exclude` patterns for client testing helpers
    that should not factor into coverage.
status: implemented
date: "2026-05-21"
---

# c3-docs-codemap-sync

## Goal

Bring the `.c3/` topology back into agreement with the current `src/` tree.
Add two missing server feature components (`c3-226 kanna-mcp-host` and
`c3-227 auto-continue`) and extend code-map patterns on existing client,
server, and shared components so `c3x lookup` resolves every shipping
source file. Establish `_exclude` patterns for client testing helpers
that should not factor into coverage.

## Context

Audit on 2026-05-21 (`c3x check` + per-file `c3x lookup`) found ~40
uncharted source files. The largest gaps are:

- `src/server/kanna-mcp.ts`, `src/server/kanna-mcp-http.ts`,
`src/server/kanna-mcp-tools/**` (24 files), `src/server/tool-callback.ts`,
`src/server/permission-gate.ts` — the entire MCP host surface that
`CLAUDE.md` already documents under "Kanna-MCP Built-in Shims" and
"Tool Callback Feature Flag" has no owning component.
- `src/server/auto-continue/**` (11 files: limit-detector, schedule-manager,
auth-error-detector, read-model, events, plus tests) has no owning
component and is not described in `CLAUDE.md`.
- `src/client/app/AppBootstrap.tsx`, `src/client/components/editor-icons.tsx`,
`src/client/components/open-external-menu.tsx`,
`src/client/components/settings/PushNotificationsSection*` —
unowned client surfaces.
- `src/shared/analytics.ts`, `mask-oauth-key.*`, `mention-pattern.ts`,
`permission-policy.*`, `projectFileRelocation.*`, `projectFileUrl.*`,
`types.test.ts`, `kanna-system-prompt.test.ts` — shared utilities
not mapped to any of `c3-301..c3-306`.

Constraint: `.c3/` is CLI-only (HARD RULE). All edits go through
`c3x add` / `c3x set` / `c3x write`. ADRs cannot be created as
`implemented`; transition `proposed → accepted → implemented` after the
sync work lands.

## Decision

Treat the audit-surfaced drift as a single, atomic doc-sync change:

1. Create `c3-226 kanna-mcp-host` (feature) under `c3-2 Server`, owning
the MCP host runtime + 8 built-in shims + durable approval protocol
(`tool-callback.ts`, `permission-gate.ts`). Cite `ref-tool-hydration`,
`ref-strong-typing`, `ref-local-first-data`, `rule-strong-typing`,
`rule-colocated-bun-test`.
2. Create `c3-227 auto-continue` (feature) under `c3-2 Server`, owning the
provider rate-limit / auth-error detection + scheduled resume + read
model under `src/server/auto-continue/**`. Cite `ref-event-sourcing`,
`ref-cqrs-read-models`, `ref-strong-typing`, `rule-colocated-bun-test`,
`rule-strong-typing`.
3. Append `c3-2 Components` table rows for `c3-226` and `c3-227`.
4. Extend code-map patterns on existing components:
`c3-110 app-shell` += `src/client/app/AppBootstrap.tsx`

`c3-116 settings-page` += `src/client/components/settings/**/*.tsx`

`c3-115 chat-ui-chrome` += `src/client/components/open-external-menu.tsx`

`c3-103 ui-primitives` += `src/client/components/editor-icons.tsx`

`c3-301 types` += `src/shared/kanna-system-prompt.test.ts`,
`src/shared/types.test.ts`, `src/shared/mask-oauth-key.{ts,test.ts}`,
`src/shared/mention-pattern.ts`, `src/shared/permission-policy.{ts,test.ts}`,
`src/shared/projectFileRelocation.{ts,test.ts}`,
`src/shared/projectFileUrl.{ts,test.ts}`, `src/shared/analytics.ts`

5. Add `_exclude` for `src/client/lib/testing/**` (test plumbing, not
feature code) — codemap append with `_exclude` prefix per c3x convention.
6. Run `c3x check` until clean; mark ADR `accepted` then `implemented`.

This is preferred over piecemeal ADRs because every drift item shares a
single root cause (audit catch-up after MCP host + auto-continue features
shipped without doc updates), and one ADR keeps the cascade gate (Phase 3a)
simple: one parent-delta entry per affected container, one verification pass.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-2 | container | Two new feature components join ## Components; Responsibilities row added for MCP host + auto-continue | Update Components table + Responsibilities |
| c3-110 | component | code-map extension adds AppBootstrap.tsx and surrounding shell file | Frontmatter codemap append only; body unchanged |
| c3-103 | component | code-map extension adds editor-icons.tsx UI primitive | Frontmatter codemap append only; body unchanged |
| c3-115 | component | code-map extension adds open-external-menu.tsx chrome surface | Frontmatter codemap append only; body unchanged |
| c3-116 | component | code-map extension adds settings/PushNotificationsSection panel | Frontmatter codemap append only; body unchanged |
| c3-301 | component | code-map extension absorbs shared utilities (kanna-system-prompt.test, mask-oauth-key, mention-pattern, permission-policy, projectFile*, types.test, analytics) that all live at the shared-type boundary | Frontmatter codemap append only; body unchanged |
| N.A - new components c3-226 + c3-227 are created by this same ADR; they cannot be listed as pre-existing affected entities, see Work Breakdown | N.A - reason above | N.A - reason above | N.A - reason above |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-tool-hydration | c3-226 owns MCP-side normalization of tool calls before they hit the agent loop | comply |
| ref-local-first-data | MCP shims and tool-callback persist pending requests under ~/.kanna/data, must stay local-first | comply |
| ref-event-sourcing | c3-227 schedules retries via event log (auto_continue_scheduled / triggered events) and persists state through event-store | comply |
| ref-cqrs-read-models | c3-227 derives its current schedule view from event replay | comply |
| ref-strong-typing | New MCP tool surface + auto-continue read-model cross client↔server boundary; need named types | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | All new MCP shim args/results and auto-continue events cross WebSocket + JSONL boundaries | comply |
| rule-colocated-bun-test | Every new component already has colocated .test.ts files; documentation must keep that fact mapped | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Create c3-226 | c3x add component kanna-mcp-host --container c3-2 --feature --goal ... --file body.md | .c3/c3-2-server/c3-226-kanna-mcp-host.md exists; c3x list shows it |
| Wire c3-226 refs/rules | c3x wire c3-226 ref-tool-hydration ref-strong-typing ref-local-first-data rule-strong-typing rule-colocated-bun-test | c3x read c3-226 shows uses: line |
| Create c3-227 | c3x add component auto-continue --container c3-2 --feature --goal ... --file body.md | .c3/c3-2-server/c3-227-auto-continue.md exists |
| Wire c3-227 refs/rules | c3x wire c3-227 ref-event-sourcing ref-cqrs-read-models ref-strong-typing rule-strong-typing rule-colocated-bun-test | c3x read c3-227 shows uses: line |
| Update c3-2 Components | c3x write c3-2 --section Components --file components.md (regenerate table including 226+227) | c3x read c3-2 --section Components shows both rows |
| Extend codemaps | c3x set <id> codemap "<patterns>" --append for c3-103, c3-110, c3-115, c3-116, c3-301 | c3x lookup <added-file> resolves |
| Add exclude | c3x set c3-1 codemap "_exclude:src/client/lib/testing/**" --append (or owning component) | c3x check no longer counts testing helpers |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| Component files | New files .c3/c3-2-server/c3-226-kanna-mcp-host.md and .c3/c3-2-server/c3-227-auto-continue.md written via c3x add | ls .c3/c3-2-server/ lists both |
| Container body | c3-2 README updated via c3x write c3-2 --section Components | c3x read c3-2 --section Components includes both new rows |
| Frontmatter codemap | c3x set <id> codemap "..." --append on c3-103, c3-110, c3-115, c3-116, c3-301, c3-226, c3-227 | c3x lookup resolves the previously uncharted paths |
| Cache | .c3/c3.db cache reseals via the same CLI calls | c3x check exits 0 |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3x check | Reports coverage gap if any of the newly-mapped files become uncharted again | c3x check exits 0 post-sync |
| c3x lookup | Resolves every src/server/kanna-mcp*, kanna-mcp-tools/**, tool-callback.ts, permission-gate.ts to c3-226 | per-file c3x lookup returns the component |
| c3x lookup | Resolves src/server/auto-continue/** to c3-227 | per-file c3x lookup returns the component |
| CI bun test | Existing colocated tests still run unchanged | bun test src/server/auto-continue/ green |
| CI bun run lint | No code edits in this PR, so lint must still pass | bun run lint green |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Single mega-component "server-other" absorbing all unowned files | Hides two distinct features (MCP host vs auto-continue) behind one node; defeats the audit signal that produced this ADR |
| Two separate ADRs (one per new component, one per codemap patches) | Triples ADR overhead for a single doc-sync moment with one root cause; cascade gate is simpler with one ADR |
| Map every shared utility into a new c3-307 file-relocation component | Premature; current shared utilities are small enough to live under c3-301 types until a cohesive boundary emerges |
| Leave MCP host unowned because tool-callback.ts is already documented in CLAUDE.md | CLAUDE.md is not the c3 source of truth; lookups against the file return nothing today |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Over-claiming scope on c3-226 (includes tool-callback.ts which is general-purpose approval, not MCP-specific) | Document Purpose section to clarify approval protocol is the MCP-facing surface; if a non-MCP caller later emerges, split | c3x read c3-226 Purpose mentions approval-protocol scope |
| Component-schema rejection on creation due to thin sections | Author full body per c3x schema component before c3x add | c3x add exits 0 |
| Code-map glob explosion masking future drift | Keep glob patterns narrow (src/server/auto-continue/** not src/server/auto-**) | c3x lookup on adjacent paths still returns "no match" outside the intended scope |
| Cache reseal drift on local .c3/c3.db after batch edits | Run c3x repair if c3x check reports seal drift | c3x check exits 0 |

## Verification

| Check | Result |
| --- | --- |
| c3x check | exits 0, total entity count increases by 2 (components) + 1 (this ADR), issues: empty |
| c3x lookup src/server/kanna-mcp.ts | resolves to c3-226 |
| c3x lookup src/server/kanna-mcp-tools/bash.ts | resolves to c3-226 |
| c3x lookup src/server/tool-callback.ts | resolves to c3-226 |
| c3x lookup src/server/auto-continue/schedule-manager.ts | resolves to c3-227 |
| c3x lookup src/client/app/AppBootstrap.tsx | resolves to c3-110 |
| c3x lookup src/client/components/settings/PushNotificationsSection.tsx | resolves to c3-116 |
| c3x lookup src/shared/projectFileUrl.ts | resolves to c3-301 |
| bun test | exits 0 (no code touched) |
| bun run lint | exits 0 |
| PR CI | All checks green on cuongtranba/kanna |
