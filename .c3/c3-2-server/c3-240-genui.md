---
id: c3-240
c3-seal: 95a43edbe9fdd3ecd8027f477d0cdbf4f75660bcf0b7a2502b7caf2bd5ce6de5
title: genui
type: component
category: feature
parent: c3-2
goal: Resolve generative UI datasets from workspace files and MCP tools under the chat's authorization, and ask the model once to fix an invalid view.
uses:
    - ref-side-effect-adapter
    - rule-colocated-bun-test
---

## Goal

Resolve generative UI datasets from workspace files and MCP tools under the chat's authorization, and ask the model once to fix an invalid view.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | GenUIDatasetService is created at boot; the guard runs at the turn-end seam of both runners |
| Consumers | c3-208 (genui.dataset.query and genui.dataset.approve), c3-210 (turn-end guard), c3-226 (validate_ui tool) |
| Boundary | Owns data access and the end-of-turn correction; the spec contract belongs to c3-315 and rendering to c3-123 |

## Purpose

Owns the server half of generative UI: resolving file and MCP datasets with a byte-bounded cache, authorizing each read, per-chat approval of MCP tools that do not declare readOnlyHint, the validate_ui tool, and the end-of-turn guard that escalates an invalid view once. Non-goals: validating spec shape itself, rendering, and writing data anywhere.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | File and MCP IO live only in dataset-file.adapter.ts and mcp-data-client.adapter.ts | must follow | The service takes them as ports |
| adr-20260929-generative-ui | adr | Dataset authorization, turn-end guard composition, content-hash escalation key | must follow | Codex gets the guard without tool wording |
| rule-colocated-bun-test | rule | Behaviour is pinned by colocated suites | must follow | dataset-service.test.ts, genui-guard.test.ts |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| File datasets | IN | A path resolves inside the chat cwd by realpath, and readPathDeny is checked against both the written and the real path | c3-208 | src/server/genui/dataset-service.test.ts |
| MCP datasets | IN | A tool is called only when it declares readOnlyHint or the user approved it for this chat; approvals are in memory | c3-208 | src/server/genui/dataset-service.test.ts |
| DatasetQueryOutcome | OUT | ok, needs_approval, or error with a stable code; decoded with Zod on the client | c3-123 | src/shared/genui/protocol.ts |
| Turn-end guard | OUT | composeTurnEndGuards feeds the mermaid and GenUI guards through one runner dep; an invalid view is escalated once per content hash | c3-210 | src/server/genui/genui-guard.test.ts |
| validate_ui | OUT | Returns VALID or the issue list, and resolves file datasets | c3-226 | src/server/genui/validate-ui-tool.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/ws-router-genui.ts | c3-240 Contract | Handler shape | src/server/ws-router-genui.ts |
| src/server/turn-end-guard.ts | c3-240 Contract | Guard order | src/server/turn-end-guard.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| A denied file is read through a symlink or a macOS private path | Only one of the lexical and real path is checked | A denied path returns rows | bun run test src/server/genui/dataset-service.test.ts |
| Inline financial data reaches logs | The escalation key is the spec instead of its hash | Spec text in the escalation log | bun run test src/server/genui/genui-guard.test.ts |
| runClaudeSession breaches its complexity ceiling | A second guard call is added in the runner | bun run lint fails on complexity | bun run lint |
