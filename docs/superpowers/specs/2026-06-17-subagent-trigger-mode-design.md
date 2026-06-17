# Subagent Trigger Mode — Design

Date: 2026-06-17
Status: Approved (design)

## Problem

A subagent's `description` is injected verbatim into the **main model's**
system prompt roster (`buildKannaSystemPromptAppend`). When a description is
written as an imperative aimed at the subagent itself — e.g. the
`4-golden-rules` subagent's `"For every code change request, follow the four
phases below"` — the main model reads it as an instruction to **itself** and
auto-delegates without the user asking. Observed in chat
`9a17fefa-f9d1-4091-ad95-4c9b6b0c011d`: a plain "implement this issue" prompt
triggered an unrequested `delegate_subagent({subagent_id:"4-golden-rules"})`.

Users need explicit control over **which subagents the main model may delegate
to autonomously** versus **which require an explicit `@agent/<name>` mention**
from the user.

## Goal

Add a per-subagent `triggerMode` (`"auto" | "manual"`):

- `auto` — main model may delegate freely (current behavior, the default).
- `manual` — main model may delegate **only** when the user `@agent/<name>`-
  mentions that subagent in the message that started the turn. Enforced
  server-side (hard block), not by prompt suggestion alone.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Enforcement strictness | **Hard server block** — orchestrator rejects manual delegations that lack a matching mention (`MANUAL_ONLY`). |
| Default for existing + new subagents | **`auto`** — preserves current behavior; no migration write. |
| Roster visibility of manual subagents | **Separate always-shown section** in the system prompt (static, PTY-safe). Server block is the real enforcement. |

## Architecture

### 1. Type + persistence (`src/shared/types.ts`, `src/server/app-settings.ts`)

- Add `triggerMode: SubagentTriggerMode` (`"auto" | "manual"`) to `Subagent`.
- Add optional `triggerMode?` to `SubagentInput` and `SubagentPatch`.
- Read-side default: `app-settings` normalize coerces a missing/invalid
  `triggerMode` to `"auto"` on load. No on-disk migration — old entries simply
  read as `auto`.

### 2. Roster split (`src/shared/kanna-system-prompt.ts`)

`buildKannaSystemPromptAppend` partitions the (already rank-limited) roster:

- `## Available subagents` — `triggerMode === "auto"` only. Existing
  delegation guidance unchanged.
- `## Manual subagents (delegate ONLY when the user @-mentions them)` —
  `triggerMode === "manual"`. Same `- name [id=…]: desc` line format, plus a
  one-line instruction: the main model must NOT delegate to these unless the
  user explicitly wrote `@agent/<name>` in their latest message.

Both sections respect `KANNA_SUBAGENT_ROSTER_LIMIT` (combined cap, ranked by
`updatedAt` desc as today). If only one partition is non-empty, only that
section renders. The roster is static per spawn — no per-turn rebuild — so the
PTY driver (system prompt set once at spawn) is unaffected.

### 3. Server hard block (`src/server/kanna-mcp.ts`, `subagent-orchestrator.ts`, `agent.ts`)

- Extend `KannaMcpDelegationContext` with `mentionedSubagentIds: string[]`.
- In `agent.ts`, populate it from `parseMentions(triggeringUserContent,
  subagents)` for the turn — the resolved subagent ids the user `@`-mentioned.
- `delegateRun` (and the MCP `delegate_subagent` handler) gains the check:
  after resolving the target subagent, if
  `subagent.triggerMode === "manual"` **and** its id is not in
  `mentionedSubagentIds`, fail with new error code `MANUAL_ONLY` (message:
  `"Subagent <name> is manual-trigger; the user must @-mention it to delegate"`).
- Sub-spawn-sub: child delegation contexts inherit an **empty**
  `mentionedSubagentIds`, so a subagent cannot drive a manual subagent. The
  user-mention authority lives only at the top turn.

### 4. Error surface (`src/shared/types.ts`, `src/client/components/messages/SubagentErrorCard.tsx`)

- Add `"MANUAL_ONLY"` to `SubagentErrorCode`.
- `SubagentErrorCard` `badgeText`: `"Manual only"`.

### 5. UI (`src/client/app/SubagentsSection.tsx`)

- Add a `FormRow label="Trigger"` with a `Select` (`Auto` / `Manual`) beside
  the existing "Context scope" row.
- `triggerMode` joins the draft/baseline diff logic (`hasUnsavedChanges`) and
  the create-defaults (`triggerMode: "auto"`).
- List rows: optionally show a small "manual" tag (low priority; can drop for
  YAGNI). Use the project `Tooltip`, not native `title`.
- Apply the impeccable skill for visual consistency with sibling rows.

## Data flow

```
user message ("@agent/foo do X")
  → agent.ts: parseMentions → mentionedSubagentIds=[foo.id]
  → delegationContext.mentionedSubagentIds threaded into kanna-mcp host
  → main model calls delegate_subagent({subagent_id})
      → resolveSubagent(id|name)
      → if manual && id ∉ mentionedSubagentIds → MANUAL_ONLY (fail)
      → else run
```

## Error handling

- `MANUAL_ONLY` flows through the same `failRun` path as `UNKNOWN_SUBAGENT`
  (event-sourced `subagent_run_started` + fail event), so the UI shows a
  `SubagentErrorCard` and the main model gets a typed reason it can act on
  (e.g. tell the user to @-mention).

## Testing

- `kanna-system-prompt.test.ts` — roster split: auto-only section, manual-only
  section, both, neither; combined cap.
- `subagent-orchestrator.test.ts` — `MANUAL_ONLY` when manual + unmentioned;
  success when manual + mentioned; auto unaffected; sub-spawn-sub cannot drive
  manual.
- `app-settings` — default `auto` for legacy entries; round-trip of explicit
  `manual`.
- `SubagentsSection.test.tsx` — Trigger select renders, edits draft, dirties
  the form, persists.
- `SubagentErrorCard` — `MANUAL_ONLY` badge.

## C3

- New ADR `adr-20260617-subagent-trigger-mode`.
- Update c3-210 (agent-coordinator) Contract for the `mentionedSubagentIds`
  delegation input + `MANUAL_ONLY` outcome; touch the subagent-settings
  component contract for the new field. `/c3 change` in the same PR.

## Out of scope (YAGNI)

- Per-chat overrides of trigger mode.
- Auto-rewriting existing imperative descriptions.
- Codex-specific behavior (delegation path is provider-agnostic; no change).
