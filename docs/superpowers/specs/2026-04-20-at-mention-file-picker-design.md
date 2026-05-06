# `@` File Mention in Chat Input — Design

**Status:** Draft
**Author:** Kanna
**Date:** 2026-04-20
**Reference:** Claude Code's @-mention behavior in `/home/cuong/repo/claude-code-qa/src/hooks/fileSuggestions.ts` and `/home/cuong/repo/claude-code-qa/src/utils/attachments.ts`.

## Goal

Add a Claude Code-style `@` file picker to Kanna's chat input. When the user types `@` at a word boundary:

1. A popup lists matching project files and directories.
2. Fuzzy search filters as they type.
3. Selecting a row inserts `@relative/path` text **and** registers a "mention" attachment on the current draft.
4. On submit, the server renders mention attachments into the existing `<kanna-attachments>` prompt block so the agent sees them as first-class references.

Works in both Claude and Codex sessions. Unlike uploads, mentions point at existing files under the project root — no copy into `.kanna/uploads/`.

## Non-Goals

- No file content inlining (let the agent Read on demand).
- No directory expansion (agent can `ls` when it needs to).
- No recent/most-used ranking. Bare `@` shows top-level project entries, like Claude Code.
- No line-range syntax (`@file:10-20`) in v1.
- No MCP resource mentions or agent mentions.
- No slash-command conflict handling — triggers are disjoint (`/` at start vs. `@` at word boundary).

## Architecture

```
Browser (React)
  ChatInput.tsx
    ├── <MentionPicker /> (new)             — list, arrows, Enter, Esc
    └── useMentionSuggestions(projectId)    — debounced fetch hook
        └── GET /api/projects/:id/paths?query=...
Bun Server
  server.ts
    └── handleProjectPaths(req, url, store) — new handler
        └── project-paths.ts (new)          — git ls-files + ripgrep fallback, cache
  agent.ts
    └── buildAttachmentHintText            — renders kind="mention" alongside file/image
```

### Components & Responsibilities

| Unit | Path | Responsibility |
|---|---|---|
| `project-paths.ts` | `src/server/project-paths.ts` | List project files+dirs via git / ripgrep; fuzzy-filter; cache keyed by project id with `.git/index` mtime invalidation. |
| `paths` HTTP handler | `src/server/server.ts` | Route `GET /api/projects/:id/paths?query=` → `project-paths.ts`. |
| `ChatAttachment.kind = "mention"` | `src/shared/types.ts` | New attachment variant. `contentUrl` empty, `absolutePath`/`relativePath` required. |
| `buildAttachmentHintText` | `src/server/agent.ts` | Already emits `<attachment kind="..." path="..." project_path="..." />`; additive — mentions flow through unchanged. |
| `mention-suggestions.ts` | `src/client/lib/mention-suggestions.ts` | Pure utils: `shouldShowPicker(value, caret) -> { open, query, tokenStart }`, `applyMentionToInput({ value, caret, path, kind })`. |
| `useMentionSuggestions.ts` | `src/client/hooks/useMentionSuggestions.ts` | Debounced fetch, cancellation on chat/project change, returns `{ items, loading }`. |
| `MentionPicker.tsx` | `src/client/components/chat-ui/MentionPicker.tsx` | UI shell, mirrors `SlashCommandPicker.tsx` (skeleton rows, `No matching files`, hover + keyboard). |
| `ChatInput.tsx` | `src/client/components/chat-ui/ChatInput.tsx` | Wire picker, add `"mention"` attachment to composer draft on accept. |

### Data Flow — bare `@`

```
user types "@"
  → shouldShowPicker → { open: true, query: "", tokenStart: n }
  → useMentionSuggestions fires GET /api/projects/:id/paths?query=
  → server returns top-level entries (readdir of project.localPath, dirs with trailing /)
  → MentionPicker renders rows
```

### Data Flow — typing `@src/a`

```
user extends to "@src/a"
  → shouldShowPicker → { open: true, query: "src/a" }
  → debounce 120ms → GET /api/projects/:id/paths?query=src/a
  → server runs fuzzy match on cached index (git ls-files + untracked)
  → picker shows top 50 ranked results
```

### Data Flow — accept

```
user presses Enter on "src/agent.ts"
  → applyMentionToInput: replaces "@src/a" with "@src/agent.ts" (keeps @)
  → caret moves to end of inserted path
  → attachment added:
      { id, kind: "mention", displayName: "src/agent.ts",
        absolutePath: "<project>/src/agent.ts",
        relativePath: "./src/agent.ts",
        contentUrl: "", mimeType: "", size: 0 }
  → picker closes
```

### Data Flow — submit

```
onSubmit(value, { attachments: [...mentions, ...uploads] })
  → server agent.ts buildPromptText + buildAttachmentHintText
  → prompt tail:
      <kanna-attachments>
        <attachment kind="mention" path="/.../src/agent.ts" project_path="./src/agent.ts" ... />
      </kanna-attachments>
```

## Server — path indexing

### `src/server/project-paths.ts`

```ts
export interface ProjectPath {
  path: string        // relative to project.localPath, forward slashes
  kind: "file" | "dir"
}

export async function listProjectPaths(args: {
  projectId: string
  localPath: string
  query: string
  limit?: number      // default 50
}): Promise<ProjectPath[]>
```

Behavior:

1. **Empty query** → `readdir(localPath)` at top level; dirs get trailing `/` (reported as `kind:"dir"`).
2. **Non-empty query** → use cached index:
   - If no cache for `projectId`, build synchronously on first call, then background-refresh on mtime change.
   - Index = tracked files (`git ls-files`) + untracked non-ignored files (`git ls-files --others --exclude-standard`) + derived directories (unique parent dirs up to root).
   - Non-git → ripgrep `--files --follow --hidden --glob '!.git/' --glob '!node_modules/'` (plus a short fixed exclude list from Claude Code's ripgrep args).
3. **Fuzzy match** — same ranking as existing `filterCommands` in `src/client/lib/slash-commands.ts`: prefix matches before substring matches, alphabetical within each bucket, case-insensitive.
4. **Limit** — cap at 50 to match the UI footprint (picker overlays the input).

### Caching

```ts
interface ProjectPathCache {
  projectId: string
  root: string
  files: string[]
  dirs: string[]
  gitIndexMtime: number | null   // for invalidation; null for non-git
  builtAt: number
}
```

- In-memory `Map<projectId, ProjectPathCache>` at module scope.
- Invalidation: on each request, stat `<root>/.git/index`. If mtime differs, rebuild.
- Time floor: also rebuild if `Date.now() - builtAt > 5 min`, to pick up new untracked files in non-git roots.
- `clearProjectPathCache(projectId)` exposed for tests and chat-reset flows.

### HTTP handler

Added to `src/server/server.ts` next to `handleProjectFileContent`:

```ts
async function handleProjectPaths(req: Request, url: URL, store: EventStore) {
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/paths$/)
  if (!match || req.method !== "GET") return null

  const project = store.getProject(match[1])
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 })

  const query = url.searchParams.get("query") ?? ""
  const limit = Number(url.searchParams.get("limit") ?? 50)

  const paths = await listProjectPaths({
    projectId: project.id, localPath: project.localPath, query, limit,
  })
  return Response.json({ paths })
}
```

### Auth

This endpoint reuses the same auth gate as `handleProjectFileContent`. It does not expose file contents — only paths — but it still leaks project structure, so gate behind the existing `requireAuth` wrapper used elsewhere in `server.ts`.

## Shared types

Extend `ChatAttachment` in `src/shared/types.ts`:

```ts
export type ChatAttachmentKind = "image" | "file" | "mention"

export interface ChatAttachment {
  id: string
  kind: ChatAttachmentKind
  displayName: string
  absolutePath: string
  relativePath: string
  contentUrl: string   // "" for mentions
  mimeType: string     // "" for mentions
  size: number         // 0 for mentions
}
```

Downstream code already handles unknown-kind attachments via `buildAttachmentHintText` emitting the `kind` attribute verbatim, so the change is largely additive. Rendering in `AttachmentFileCard` / `AttachmentImageCard` needs a `kind === "mention"` branch (see below).

## Client

### Trigger

`shouldShowPicker(value, caret)` in `mention-suggestions.ts`:

- Open when the token immediately before `caret` starts with `@` AND is preceded by start-of-string or whitespace.
- Token extends from `@` up to (but not including) the next whitespace.
- `query` is the substring after `@`.
- Exposes `tokenStart` (index of `@`) so accept can replace the right slice.

Closes when caret is before the `@`, or the token is broken by a space.

### Fetching

`useMentionSuggestions(projectId, query)`:

- Debounce 120ms on `query` change.
- On `projectId` change, clear cached results and cancel in-flight.
- Returns `{ items: ProjectPath[], loading: boolean, error: string | null }`.
- Zustand-backed cache per `${projectId}:${query}` to avoid re-fetch when cursor bounces.

### Picker UI (`MentionPicker.tsx`)

Mirrors `SlashCommandPicker.tsx`:

- Absolute positioned `bottom-full left-0 mb-2`, `max-h-64 overflow-auto`.
- Row = `<span class="font-mono">{path}</span>` + trailing `/` on dirs (already in the string).
- Skeleton rows while `loading && items.length === 0`.
- Empty result → "No matching files".
- Hover sets active index; `onMouseDown` accepts.

### Accept

```ts
function applyMentionToInput(args: {
  value: string
  caret: number
  tokenStart: number
  pickedPath: string   // relative, dirs end with "/"
}): { value: string; caret: number }
```

Replaces `[tokenStart, caret)` with `@${pickedPath}`. New caret = `tokenStart + pickedPath.length + 1`.

Also adds a composer attachment:

```ts
setAttachments(prev => [
  ...prev,
  {
    id: crypto.randomUUID(),
    kind: "mention",
    displayName: pickedPath,
    absolutePath: path.posix.join(project.localPath, pickedPath),
    relativePath: `./${pickedPath}`,
    contentUrl: "", mimeType: "", size: 0,
    status: "uploaded",      // ComposerAttachment discriminator — skips upload pipeline
  },
])
```

Duplicate-guard: if the same `relativePath` already exists as a mention, skip the add.

### Attachment chip rendering

`AttachmentFileCard` gets a `kind === "mention"` branch: distinct icon (lucide `FileText` or `AtSign`), no download URL, clicking opens the file via the existing `/api/projects/:id/files/:relativePath/content` route. Remove button removes both the chip **and** does NOT delete any server state (nothing to delete).

### Keyboard

Added to top of `ChatInput.handleKeyDown` before the slash-picker block (slash picker already handles its own triggers):

- If `mentionOpen`: Esc dismisses (keeps input), ArrowUp/Down navigate, Enter/Tab accept.
- Mention and slash pickers are mutually exclusive because their triggers differ (`/` at position 0 vs. `@` after a word boundary); if both think they're open, slash wins (current position 0 always implies empty token before).

### Persistence

Mention attachments persist in the chat input draft (`chatInputStore.setAttachmentDrafts`) alongside uploads. No extra store needed — the existing draft list already handles arbitrary `ChatAttachment` objects.

## Error & edge cases

| Case | Behavior |
|---|---|
| No project open (new chat without projectId) | Picker silently suppressed. |
| Project is not a git repo | Falls back to ripgrep; if ripgrep missing, readdir walk capped at 10k entries. |
| Path was selected but file deleted before submit | Server sees `<attachment path="...missing..." />`; agent gets a clear missing-file signal. No client-side pre-validation needed for v1. |
| Huge repos (>100k files) | Cache builds once, subsequent queries do in-memory filter in <5ms. First build is the slow case; acceptable given it's cached. |
| Path with spaces | Inserted verbatim (`@dir/with spaces/file.ts`). Since the token ends at whitespace, the user must either avoid spaces or manually wrap. v1 does not support quoted `@"path with spaces"`. |
| Duplicate mention of same path | Ignored on accept (no duplicate chip). |

## Testing

### Server — `project-paths.test.ts`

- `empty query returns top-level entries` — mkdtemp, write files, assert result.
- `git query returns tracked + untracked minus ignored` — init git, add files, add .gitignore, assert.
- `non-git falls back to readdir walk` — mkdtemp without .git, assert.
- `cache invalidates on .git/index mtime change` — stub mtime, assert rebuild.
- `fuzzy ranking: prefix before substring` — assert order.
- `limit respected` — assert.

### Server — `server.test.ts`

- `GET /api/projects/:id/paths returns 404 for unknown project`.
- `GET returns JSON { paths }` for valid project.
- `GET respects ?query= and ?limit=`.

### Server — `agent.test.ts`

- `mention attachments render in <kanna-attachments> with kind="mention"`.
- `mention attachments do not fetch content from contentUrl` (ensure no HTTP call).

### Client — `mention-suggestions.test.ts`

- `shouldShowPicker` — bare `@`, `@src/`, mid-word `a@b` (should not open), caret before `@` (should not open), after space `hi @foo` (should open).
- `applyMentionToInput` — correct slice replacement, caret placement, multi-line input.

### Client — `useMentionSuggestions.test.ts`

- Debounces 120ms.
- Cancels stale fetches on projectId change.
- Caches by `${projectId}:${query}`.

### Client — `MentionPicker.test.tsx`

- Renders skeleton rows on `loading && !items.length`.
- Renders "No matching files" on `!loading && !items.length`.
- ArrowDown/Enter accept.

### Client — `ChatInput.test.ts`

- Typing `@` opens picker.
- Accepting inserts `@path` and adds mention chip.
- Removing chip leaves text intact (user must edit manually).
- Submit forwards mention attachments in `onSubmit` options.

## Observability

No new analytics in v1. The existing chat-send logs already show attachment count and kind via `buildAttachmentHintText`.

## Migration / backward compatibility

Purely additive:

- `ChatAttachmentKind` gets a new variant — existing persisted drafts with `kind: "file"` / `"image"` continue to work.
- Snapshot serialization carries the new field by virtue of `ChatRecord` passthrough, same as slash-commands (see `docs/plans/2026-04-20-slash-command-picker.md` Task 7).
- No changes to the event log schema.

## Implementation order

1. Shared type `ChatAttachmentKind` + "mention".
2. Server `project-paths.ts` + tests.
3. Server HTTP handler + tests.
4. Agent hint renderer (should just work; add assertion test).
5. Client `mention-suggestions.ts` + tests.
6. Client `useMentionSuggestions.ts` + tests.
7. Client `MentionPicker.tsx`.
8. Attachment card: `kind === "mention"` branch.
9. Wire into `ChatInput.tsx` + tests.
10. Manual verification in `bun run dev`.

## Open questions

None blocking. Flagged for future:

- Quoted `@"path with spaces"` support.
- Line-range syntax `@file:10-20`.
- Recent-mentions ranking.
- Directory selection triggering an automatic `ls` attachment payload.
