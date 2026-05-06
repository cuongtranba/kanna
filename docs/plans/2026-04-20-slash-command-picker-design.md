# Slash Command Picker Design

**Date:** 2026-04-20
**Scope:** Claude Code-style `/` command picker in Kanna chat input for the Claude provider.

## Goal

When the user types `/` in the chat input, show a popup picker listing every slash command the active Claude session exposes — built-ins (`/help`, `/clear`, `/compact`, `/model`, `/init`, `/review`, ...), user-custom (`~/.claude/commands/*.md`), project-custom (`.claude/commands/*.md`), plugin commands, and MCP commands. Match Claude Code TUI behavior: filter as the user types, arrow keys navigate, Enter selects, the full `/name [args]` string is sent to the agent on submit.

## Non-Goals (v1)

- Codex provider support. `/` types literal when Codex is the active provider.
- Hot-reload of newly authored `.md` command files mid-session.
- Kanna-side intercept of `/clear`, `/model`, `/compact`, etc. The SDK owns dispatch.
- Argument preview UI richer than the `argumentHint` hint string.
- Multi-step sub-pickers (model list, agent list). The SDK owns these.
- Command execution history or "recents".

## Data Source

The Claude Agent SDK exposes `Query.supportedCommands(): Promise<SlashCommand[]>` where

```ts
type SlashCommand = {
  name: string          // without leading slash
  description: string
  argumentHint: string  // e.g. "<file>"
}
```

This single call returns the full unified list across all sources. No filesystem scan.

## Architecture

### Lifecycle

1. `AgentCoordinator` creates a Claude session via `query({...})` (existing, `src/server/agent.ts:614`).
2. After the query object is created, the harness calls `q.supportedCommands()`.
3. Result is emitted as a new `SessionCommandsLoadedEvent` and appended to `turns.jsonl`.
4. `ReadModels` attach `slashCommands: SlashCommand[]` to the chat snapshot.
5. Client receives the snapshot over the existing WS subscription and writes it into a Zustand store.
6. `ChatInput` reads from the store via `useSlashCommands(chatId)` and drives the picker.

### Execution

- User selects a command → input becomes `/<name> ` (trailing space only when `argumentHint` is non-empty).
- User presses Enter → existing send path. The full string (`/review pr-123`) is forwarded verbatim to `sendPrompt()` → SDK dispatches it.
- Local-output commands return `SDKLocalCommandOutputMessage` with `subtype: "local_command_output"`. Rendered as assistant-style text in the transcript. Confirm Kanna's transcript hydrator handles this subtype; add a small case if not.

## Server Changes

### `src/server/events.ts`

```ts
export type SessionCommandsLoadedEvent = {
  type: "session.commands_loaded"
  chatId: string
  sessionId: string
  commands: Array<{ name: string; description: string; argumentHint: string }>
  timestamp: number
}
```

Appended to the existing `turns.jsonl` (no new event file).

### `src/server/agent.ts`

- Extend the Claude harness return type with `getSupportedCommands: () => Promise<SlashCommand[]>`.
- Implementation: `async () => { try { return await q.supportedCommands() } catch (e) { log.warn(...); return [] } }`.

### `AgentCoordinator`

- On Claude session start: await `getSupportedCommands()`, emit `SessionCommandsLoadedEvent`.
- On resume: refetch after the SDK reports the resumed session is ready; emit a fresh event so plugin/command changes between runs are reflected.
- Codex provider: skip (v1 scope).

### `src/server/read-models.ts`

- Extend the chat snapshot with `slashCommands: SlashCommand[]`.
- Replay collapses multiple `SessionCommandsLoadedEvent`s to the most recent per `chatId`.
- Snapshot compaction stores the latest list in `snapshot.json`. No growth concern.

### `src/shared/types.ts`

```ts
export type SlashCommand = {
  name: string
  description: string
  argumentHint: string
}
```

Mirror the SDK type locally so the client bundle does not pull the SDK.

### `src/shared/protocol.ts`

No new WS message type. The list rides on the existing chat snapshot broadcast.

## Client Changes

### Zustand store — `src/client/stores/slash-commands.ts`

```ts
type State = {
  byChatId: Record<string, SlashCommand[]>
  setForChat: (chatId: string, cmds: SlashCommand[]) => void
  clear: (chatId: string) => void
}
```

The socket snapshot handler calls `setForChat(chatId, snapshot.slashCommands ?? [])` on every push.

### Hook — `src/client/hooks/useSlashCommands.ts`

```ts
export function useSlashCommands(chatId: string): SlashCommand[]
```

Returns cached list or `[]`. Stable reference via selector equality.

### Filter util — `src/client/lib/slash-commands.ts`

```ts
export function shouldShowPicker(
  value: string,
  caret: number,
): { open: boolean; query: string }

export function filterCommands(
  list: SlashCommand[],
  query: string,
): SlashCommand[]
```

- `shouldShowPicker`: regex `^\/(\S*)$` on the substring from start to caret. Open when it matches and caret is inside the first token.
- `filterCommands`: case-insensitive match on `name`. Rank prefix matches first, then substring, then alphabetical.

### Picker component — `src/client/components/chat-ui/SlashCommandPicker.tsx`

Mounted as a child of `ChatInput.tsx`, positioned absolutely above the textarea.

**Row layout**

```
/name  <argumentHint>       description (muted, truncated)
```

The highlighted row gets `bg-accent` and shows the full description when space allows.

**Behavior**

| Key | Action |
|-----|--------|
| `↑` / `↓` | move selection |
| `Enter` / `Tab` | accept → insert `/<name>[ ]` |
| `Esc` | close picker, keep input |
| any printable | passthrough, filter updates |

- Cap visible rows at 8, scrollable.
- Empty state: a non-selectable "No matching commands" row.
- Accept: replaces the `/<query>` span at the caret with `/<name>` (+ trailing space if `argumentHint` is non-empty), caret moves to end, picker closes. It reopens only if the user deletes back into the `/token`.

### `ChatInput.tsx`

- New local state: `pickerOpen`, `pickerQuery`, `pickerIndex`.
- Derive `pickerOpen` and `pickerQuery` from `shouldShowPicker(value, caret)` on every change.
- Memoize filtered list.
- Intercept `↑ ↓ Enter Tab Esc` in `onKeyDown` when `pickerOpen`. Otherwise the existing send logic runs.
- Short-circuit render: if `list.length === 0 && query === ""`, do not mount the picker (avoid flash).

## Tests

- `src/client/lib/slash-commands.test.ts` — `shouldShowPicker`, `filterCommands` pure unit coverage.
- `src/client/components/chat-ui/ChatInput.test.ts` — picker open on `/`, filter as typed, arrow navigation, Enter/Tab insertion, Esc dismiss, caret placement.
- Server-side agent test — mock `query.supportedCommands`, assert event emitted, harness returns list, errors degrade to `[]`.
- Read-model test — replay two `SessionCommandsLoadedEvent`s, snapshot reflects the latest.

## Rollout Steps

1. SDK probe + shared `SlashCommand` type + `SessionCommandsLoadedEvent`.
2. Agent harness method + coordinator emit on session start and resume.
3. Read-model extension + snapshot wiring.
4. Zustand store + hook + socket handler populates store.
5. `SlashCommandPicker` component + `ChatInput` integration + filter util.
6. Unit tests + manual verification in `bun run dev`.

## Risks and Follow-Ups

- **`/model`, `/clear`, `/compact` output UX.** SDK may respond with text only. If the result is poor, v1.1 can intercept these client-side and trigger Kanna's existing model picker / transcript clear.
- **`supportedCommands()` latency.** If the call is slow, the very first `/` press after a session start shows an empty picker briefly. Acceptable; eager fetch is issued immediately after query creation.
- **Plugin / MCP invalidation mid-session.** Stale list until session restart. Acceptable v1.
- **Resume freshness.** Refetching after resume is a cheap extra call and keeps the list current when plugins change between runs.
- **Provider inconsistency.** Codex users see no picker. Picker short-circuits when the active provider is Codex so `/` types literal.
