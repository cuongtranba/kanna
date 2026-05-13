---
id: rule-strong-typing
c3-seal: e7e2a6050dc3dd2cef2272c7201fbb8acba0ad9629fa5fcf8f04d525b5b360c1
title: strong-typing
type: rule
goal: All values crossing a Kanna boundary (client↔server WebSocket envelopes, JSONL events↔read-models, provider adapter↔agent coordinator, shared module exports) must have a named TypeScript type. No `any`, no `unknown` without narrowing, no untyped object literals at boundaries. This is a project-wide standard for every package in `src/`.
---

# strong-typing

## Goal

All values crossing a Kanna boundary (client↔server WebSocket envelopes, JSONL events↔read-models, provider adapter↔agent coordinator, shared module exports) must have a named TypeScript type. No `any`, no `unknown` without narrowing, no untyped object literals at boundaries. This is a project-wide standard for every package in `src/`.

## Rule

All boundary types must be named exports (interface or discriminated union) declared in `src/shared/**` or the owning module — never `any`, never an untyped inline object, never a `Record<string, unknown>` left unnarrowed.

## Golden Example

```ts
// src/shared/types.ts
export type AgentProvider = "claude" | "codex"          // REQUIRED: discriminated union literal
export type AppThemePreference = "light" | "dark" | "system"  // REQUIRED: enumerate every variant
export type AttachmentKind = "image" | "file" | "mention"

export interface SkillSearchResult {                     // REQUIRED: named interface, exported
  id: string                                              // REQUIRED: every field typed
  skillId: string
  name: string
  installs: number
  source: string
}

export interface SkillSearchSnapshot {                    // REQUIRED: named interface for boundary value
  query: string
  searchType: string
  skills: SkillSearchResult[]                            // REQUIRED: nested type by name, not inline
  count: number
  duration_ms: number                                     // OPTIONAL: snake_case field allowed at protocol boundary
}
```

File: `src/shared/types.ts`

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| function handle(payload: any) { ... } | function handle(payload: WsEnvelope) { ... } | Loses discriminated-union narrowing; tool-hydration switch cannot exhaustively check kinds |
| const event = JSON.parse(line) as Record<string, unknown> | Parse into a named KannaEvent union via runtime guard | Read-model projection compiles but crashes when shape drifts |
| interface Foo { data: object } | interface Foo { data: SkillSearchResult } | object accepts anything; refactors do not catch field renames |
| const result: { ok: boolean; data?: any } = ... | Declare interface Result { ok: boolean; data?: SkillSearchResult } and export | Inline object types do not survive cross-file refactors |

## Scope

**Applies to:**

- `src/shared/**/*.ts` — wire protocol, shared domain types
- `src/server/events.ts`, `src/server/read-models.ts`, `src/server/agent.ts`, `src/server/codex-app-server.ts`, `src/server/provider-catalog.ts`, `src/server/process-utils.ts`, `src/server/update-manager.ts`, `src/server/cloudflare-tunnel/**/*.ts`
- `src/client/app/socket.ts`, `src/client/components/messages/**/*.tsx`, `src/client/components/ui/**/*.tsx`, `src/client/stores/**/*.ts`

**Does NOT apply to:**

- Test files using `as unknown as <T>` for fixture narrowing (allowed only inside `*.test.ts(x)` and only at the assertion site)
- Third-party untyped JSON crossing the boundary once — must be narrowed into a named type before any internal consumer sees it

## Override

To deviate:

1. Document in an ADR `Compliance Rules` row with action `override` and a repo-specific reason
2. Cite rule-strong-typing
3. Name the exact symbol or file scope of the deviation
4. Add a runtime narrowing guard at the boundary so downstream code still sees a named type
