# Phase 2 — Subagent CRUD & Mentions

Date: 2026-05-13
Status: Design (depends on phase 1; not implementation-ready until phase 1 ships)
Parent: [Model-Independent Chat Sessions — Overview](./2026-05-13-model-independent-chat-sessions-design.md)
Depends on: [Phase 1](./2026-05-13-model-independent-chat-phase1-provider-switching.md)

## Goal

Add user-configurable subagents to `app-settings.json` with full CRUD, and
make `@agent/<name>` mention parsing server-authoritative. Phase 2 does
not run subagents — that lands in phase 3. Phase 2 ships the data shape,
settings UI, picker integration, and the parse + validate pipeline so
phase 3 can plug the orchestrator in cleanly.

## Out of scope

- Running subagents (phase 3).
- `SubagentRunSnapshot`, `subagent_run_*` events (phase 3).
- Transcript projection of subagent messages (phase 3).

## Data model

### `Subagent`

Stored as a new top-level array in `app-settings.json`:

```ts
type Subagent = {
  id: string           // ULID, stable across renames
  name: string         // user-visible, used in @agent/<name>
  description?: string
  provider: AgentProvider
  model: string
  modelOptions: ClaudeModelOptions | CodexModelOptions
  systemPrompt: string
  contextScope: "previous-assistant-reply" | "full-transcript"
  createdAt: number
  updatedAt: number
}
```

No `builtin` flag; per consensus item 4, phase 2 ships with **no seeded
built-ins**. Subagent list starts empty.

### Name validation (consensus item 12)

Applied in `normalizeAppSettings` on every CRUD operation:

- Trim before all checks.
- Regex: `^[a-z0-9_-]+$`.
- Reject empty string, leading `.`, any `/`.
- Reserved names: `agent`, `agents`.
- Case-insensitive uniqueness across `subagents[]`.
- Max length 64 chars.

Validation failures surface as a typed error in the CRUD response.

## App-settings touch points (consensus item 18)

In `src/server/app-settings.ts`:

| Symbol | Change |
|---|---|
| `AppSettingsFile` interface | Add `subagents: Subagent[]` |
| `normalizeAppSettings` | Per-entry normalizer; validation; sort by `createdAt` |
| `toFilePayload` | Emit `subagents` |
| `toSnapshot` | Include `subagents` in snapshot |
| `toComparablePayload` | Hash includes `subagents` |
| `applyPatch` | Accept `subagents` patch ops |
| `createSubagent(input)` | Atomic write + emit snapshot |
| `updateSubagent(id, patch)` | Reject on missing id; validate; atomic write |
| `deleteSubagent(id)` | Atomic write; idempotent on missing |

In `src/shared/types.ts`:

- Export `Subagent`, `SubagentInput`, `SubagentPatch`.
- Extend `AppSettingsPatch` / `AppSettingsSnapshot` with the new array.

## Protocol changes

`src/shared/protocol.ts` adds (WebSocket frames):

- `subagent_list` (server → client) — pushed when app-settings snapshot
  changes; full list.
- `subagent_create` (client → server) — `SubagentInput` payload.
- `subagent_update` (client → server) — `{ id, patch: SubagentPatch }`.
- `subagent_delete` (client → server) — `{ id }`.
- Each server response includes typed validation errors when applicable.

## Mention parsing (consensus item 5)

Server-authoritative. Lives in a new module `src/server/mention-parser.ts`:

```ts
type ParsedMention =
  | { kind: "subagent"; subagentId: string; raw: string }
  | { kind: "path"; path: string; raw: string }
  | { kind: "unknown-subagent"; name: string; raw: string }

function parseMentions(
  text: string,
  subagents: Subagent[],
  paths: ProjectPath[],
): ParsedMention[]
```

Rules:

- `@agent/` namespace reserved. Match `@agent/[a-z0-9_-]+` BEFORE any
  file-path mention rule fires.
- Look up the matched name (case-insensitive) in the supplied subagents.
  Hit → `{ kind: "subagent", subagentId }`. Miss →
  `{ kind: "unknown-subagent", name }` so the orchestrator (phase 3) can
  surface an `UNKNOWN_SUBAGENT` error.
- After `@agent/` matches are extracted, run existing path mention logic
  on the remaining text.

Phase 2 wires the parser at message-receive time and stores the resolved
`subagentMentions: Array<{ subagentId: string; raw: string }>` on the
appended `message_appended` event payload. Phase 3 reads it.

### Stale-id handling

If a queued message references a subagent that has since been deleted,
phase 3's orchestrator emits `subagent_run_failed { code: "UNKNOWN_SUBAGENT" }`.
Phase 2 ensures the id is at least syntactically valid at parse time.

## Client picker (consensus item 15)

`src/client/hooks/useMentionSuggestions.ts` — UNCHANGED return type
(`{ items: ProjectPath[]; loading; error }`). Existing callers untouched.

New hook `src/client/hooks/useSubagentSuggestions.ts`:

```ts
function useSubagentSuggestions(query: string): {
  items: Subagent[]
  loading: boolean
  error: Error | null
}
```

`src/client/components/chat-ui/MentionPicker.tsx`:

- Calls both hooks.
- Renders two sections: **Agents** first when any match, **Files** below.
- Section headers shown when both sections have results.
- Selecting an agent inserts `@agent/<name> ` (trailing space) via
  `applyMentionToInput` (extended for the new sigil branch).
- `@` token detection rule (`shouldShowMentionPicker`) unchanged.

`src/client/components/chat-ui/ChatInput.tsx`:

- Below the textarea, render read-only chips for each parsed
  `@agent/<name>` mention so the user sees which subagents will run.
- Chip text reflects the resolved `Subagent.name`; unresolved names show
  an error chip.

## Settings UI

`src/client/app/SettingsPage.tsx` — new "Subagents" section between
provider settings and existing sections:

- List view: each subagent shows name, description, provider icon, model.
- "New subagent" button → editor form.
- Editor form:
  - `name` (text, validated client-side with same rules as server)
  - `description` (text)
  - `provider` (selector, reuses `ChatPreferenceControls` provider switch)
  - `model` + `modelOptions` (reuses `ChatPreferenceControls`)
  - `systemPrompt` (multiline)
  - `contextScope` (radio: "Previous assistant reply only" /
    "Full conversation transcript")
- Delete confirmation modal; soft-disabled while save in flight.

## Testing

`src/server/app-settings.test.ts` — extend:

- CRUD round-trip: create → update → delete.
- Validation: trim, case-insensitive uniqueness, reserved names, regex,
  leading dot, `/`, empty.
- Atomic write contract preserved (no partial writes on crash).

`src/server/mention-parser.test.ts` (new):

- `@agent/foo` resolves to subagent when present.
- `@agent/missing` returns `unknown-subagent`.
- Path mentions don't consume `@agent/` prefix.
- Case-insensitive name match.
- Mixed text: path + agent + plain text round-trips.

`src/client/hooks/useSubagentSuggestions.test.ts` (new):

- Query filters by name + description.
- Updates when snapshot pushed.

`src/client/components/chat-ui/MentionPicker.test.tsx` — extend:

- Renders both sections when both have hits.
- Selecting an agent inserts `@agent/<name> `.

`src/client/app/SettingsPage.test.tsx` — extend:

- Editor form validation matches server rules.

## Implementation order

1. `Subagent` type + app-settings normalizer + validation + tests.
2. CRUD methods + protocol frames + tests.
3. Server-side mention parser + tests.
4. `useSubagentSuggestions` hook + `MentionPicker` integration.
5. Settings UI editor.
6. Wire chip rendering in `ChatInput`.

Phase 2 ships with `subagentMentions` parsed and stored on
`message_appended`, but the orchestrator that consumes them is phase 3.
Until phase 3 lands, mentions are no-ops at runtime (parsed and ignored).
