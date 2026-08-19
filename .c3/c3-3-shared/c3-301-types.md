---
id: c3-301
c3-version: 4
c3-seal: e40d35fd9b3e7afa28ff2a5a46aa5bce3de9e7193a4af74077e36887b83fcf3e
title: types
type: component
category: foundation
parent: c3-3
goal: Declare core domain types (projects, chats, turns, transcript entries, provider catalog shape) shared by client and server.
uses:
    - ref-strong-typing
    - rule-strong-typing
---

# types

## Goal

Declare core domain types (projects, chats, turns, transcript entries, provider catalog shape) shared by client and server.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 (shared) |
| Parent Goal Slice | "Define the typed surface shared between client and server" |
| Category | foundation |
| Lifecycle | Pure type module |
| Replaceability | Replaceable provided exported type names + shapes preserved |

## Purpose

Defines the discriminated unions and structural types that cross the wire: project records, chat snapshots, transcript entries, provider catalog entries. Non-goals: I/O, validators, runtime helpers.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | TypeScript strict mode | c3-3 |
| Input — provider catalog | Re-exports catalog types | c3-212 |
| Internal state | None — pure types | c3-301 |
| Initialization | Imported by both containers on demand | c3-301 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Client and server agree on shape of every entity | c3-101 |
| Primary path | Server emits typed projection → client decodes typed | c3-208 |
| Alternate — picker | Client uses re-exported catalog types in pickers | c3-115 |
| Alternate — write | Server constructs typed events using these types | c3-205 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | All shared types are explicit | must follow | No any/unknown exports |
| rule-strong-typing | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Domain type exports | OUT | Project/chat/turn/transcript types | c3-1 | src/shared/types.ts |
| Catalog re-exports | OUT | Provider catalog types via shared module | c3-115 | src/shared/types.ts |
| Subagent restriction fields | OUT | workingDir + allowedPaths on Subagent / SubagentInput / SubagentPatch; SubagentValidationErrorCode includes RESTRICTION_NOT_SUPPORTED, INVALID_PATH, PATH_ESCAPE, EMPTY_ALLOWED_PATHS | c3-210 | src/shared/types.ts |
| SidebarProjectGroup.sourceProvider | OUT | Optional AgentProvider inferred from chat history or unambiguous single-provider discovery; absent when ambiguous; consumed by getMostRecentProjectProvider as provider hint for new chats | c3-110 | src/shared/types.ts |
| ChatActivity / EMPTY_CHAT_ACTIVITY | OUT | Compact live-state for a sidebar chat row (agents, workflow, loop, backgroundTasks, cron, awaitingAnswer, lastFailure); lastFailure carries the reason the chat's last run failed, null when nothing failed OR the failure recorded no reason, so a surface degrades to a bare failure label rather than a dangling separator; EMPTY_CHAT_ACTIVITY is the zero value | c3-208 | src/shared/types.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Cross-wire drift | Type renamed only on one side | tsc fails on consumer | bun run check against src/shared/types.ts |
| Re-export break | Catalog re-export missing | tsc fails on UI picker | bun run check plus grep src/client/ for missing catalog imports |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/types.ts | c3-301 Contract | Type detail | src/shared/types.ts |
