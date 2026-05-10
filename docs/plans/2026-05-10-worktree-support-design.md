# In-Project Git Worktree Support

**Date:** 2026-05-10
**Status:** Design

## Problem

Kanna users who run multiple parallel sessions on the same repository must stop work, switch branches, and risk merge or stash conflicts. Today every Kanna project resolves to a single `localPath` (`src/server/event-store.ts:763`), and every chat inherits that path as its `cwd` (`src/server/agent.ts:101`). The only workaround is to register each `git worktree` directory as a separate top-level project, with no automation, no detection, and no UI to manage worktrees from inside Kanna.

The user wants to keep `main` cleanly checked out while feature work happens in isolated worktrees, all from a single Kanna project view.

## Goal

Make a Kanna project a first-class container for the repository's git worktrees. Detect existing worktrees automatically, let the user create and remove worktrees from the UI, and bind every chat to exactly one worktree so concurrent chats never collide on a shared working tree.

## Scope

In scope:

- Detect worktrees via `git worktree list --porcelain` on project open and via a manual refresh button.
- Create worktrees from the UI with a new branch or an existing branch, base configurable, default base = repo default branch.
- Remove worktrees from the UI with a two-step confirmation when the worktree has uncommitted changes.
- Pin every chat to a single worktree at creation time. Chats inherit that worktree's path as their `cwd`.
- Mark worktrees orphaned (read-only chat history) when the worktree disappears on disk.
- Configurable storage directory per project, default `.worktrees/`.
- Mobile and desktop UI parity.

Out of scope (YAGNI):

- Detached-HEAD worktrees.
- Auto-rename worktree on branch rename.
- Reassigning a chat from one worktree to another.
- Cross-worktree diff comparison.
- Automatic `git worktree repair` when a worktree dir moves.

## Architecture

### Data model — event store

Append-only events:

```ts
worktree_added     { projectId, worktreeId, path, branch, base?, createdAt }
worktree_removed   { projectId, worktreeId, removedAt, force }
worktree_renamed   { projectId, worktreeId, newBranch }   // optional
worktree_backfill_v1 { projectId, primaryWorktreeId }    // migration guard
```

Derived project state gains:

```ts
type Worktree = {
  id: string                  // stable, generated on add
  path: string                // absolute
  branch: string              // current branch or "(detached)"
  isPrimary: boolean          // exactly one true per project
  status: "active" | "orphaned"
}

type Project = {
  // existing fields...
  worktrees: Worktree[]
  worktreeDir?: string        // default ".worktrees"
}
```

`chat_created` gains optional `worktreeId`. Chats lacking the field at replay time resolve to the project's primary worktree (driven by `worktree_backfill_v1`).

### Server module

`src/server/worktree-store.ts`:

```ts
listWorktrees(repoRoot): Promise<GitWorktree[]>
addWorktree(repoRoot, opts): Promise<GitWorktree>
removeWorktree(repoRoot, path, opts: { force }): Promise<void>
isDirty(worktreePath): Promise<{ dirty: boolean; fileCount: number }>
```

Implementation reuses `runGit()` from `src/server/diff-store.ts`. All git operations serialize per repository through the existing `runGit` mutex; if no per-repo lock exists, add one for worktree mutations.

### Reconcile strategy

Git is the source of truth. Kanna events are the projection.

1. **On project open** — call `listWorktrees(repoRoot)`, diff against event-derived state.
   - Present in git, absent in Kanna → emit `worktree_added` (auto-detect shell-created worktrees).
   - Present in Kanna, absent in git → set `status: "orphaned"`, run `git worktree prune`.
2. **Manual refresh** — re-run reconcile, surface in worktree switcher.
3. **After Kanna's own mutations** — emit event immediately, no reconcile.

### Chat cwd binding

`agent.ts` currently reads `project.localPath` to set the chat `cwd`. Change to:

```ts
const worktree = project.worktrees.find(w => w.id === chat.worktreeId)
if (!worktree || worktree.status === "orphaned") {
  // refuse to run; surface "worktree removed" error
}
const cwd = worktree.path
```

`resolveRepo()` in `diff-store.ts:265` already accepts a path; pass `worktree.path`.

### Migration

One-time, idempotent, guarded by `worktree_backfill_v1`:

1. For each project, call `listWorktrees(localPath)`.
2. Emit `worktree_added` for each, mark first one `isPrimary: true`.
3. Emit `worktree_backfill_v1 { projectId, primaryWorktreeId }`.
4. On any `chat_created` lacking `worktreeId`, resolver returns the primary worktree's id.

### Path resolution

`addWorktree` resolves `<worktreeDir>/<branch-slug>` against `project.localPath`. Branch slug normalizes `feat/x` → `feat-x`. On collision, append numeric suffix (`feat-x-2`).

## Client UI

### Worktree switcher

Top of the project view, left of the chat list:

```
┌─────────────────────────────┐
│ [▼ main (current)]    [+] [⟳]│
└─────────────────────────────┘
│  feat/auth-redesign          │
│  fix/timing-bug   ⚠ orphaned │
│  ─────────────                │
│  + New worktree...            │
```

Selecting a worktree filters the chat list to chats bound to that worktree. Primary worktree pre-selected on project open. Orphaned entries render in red and chats inside become read-only.

### Create modal

```
○ New branch     [_____________]   from [main ▼]
○ Existing branch [pick branch ▼]
Path: .worktrees/<auto-from-branch>   [edit]
[Cancel]                          [Create]
```

The path field shows the resolved preview. Editing the directory portion writes `worktreeDir` back to the project setting.

### Remove flow

1. Right-click → "Remove". Run `isDirty()`. If clean → confirm → `git worktree remove`.
2. If dirty → modal: "X uncommitted files. Cannot remove safely." Single button "Close".
3. Re-click "Remove" on a dirty worktree → second modal: "Force remove? Discards X files." A checkbox "I understand" must be checked before the button enables. Then `git worktree remove --force`.

### Chat creation

The "New chat" button always operates in the context of the currently selected worktree. The chat header renders a `branch: feat/x` badge so the user always knows the cwd.

### Mobile

The switcher collapses into a drawer entry above the chat list. All other behavior matches desktop.

## Error surfaces

| Case | Behavior |
|------|----------|
| `localPath` not a git repo | Hide worktree switcher entirely. Project works as today. |
| `git worktree add` fails (locked, branch exists, path conflict) | Surface stderr in the modal; emit no event. |
| Branch name collides with existing worktree | Server checks before spawn; reject with hint. |
| User deletes worktree dir manually | Next reconcile marks it orphaned and runs `git worktree prune`. |
| Worktree path moved on disk | No auto-repair; show warning + manual button. |
| Chat is running when remove is requested | Block remove with "chat running" error until canceled (mirrors background task gating). |
| Two Kanna sessions race on the same project | Event store already serializes; last writer wins, reconcile next open. |

## Testing strategy

Unit tests (Bun, against a temp git repo):

- `worktree-store.test.ts` — porcelain parsing, primary detection, add/remove (clean and dirty), `isDirty`, slug + collision suffix.
- `event-store.test.ts` — `worktree_added/removed/backfill_v1` reducers, chat `worktreeId` fallback.
- `agent.test.ts` — chat cwd resolves to the bound worktree; orphan refusal.

Integration tests:

- Project-open reconcile: shell-create a worktree, open project, assert `worktree_added` emitted.
- Migration: load a fixture event log lacking worktrees; assert backfill emitted and chats bound to primary.
- Remove with `--force` end-to-end through the server API.

Subprocess discipline (per project `CLAUDE.md`):

```ts
spawn("git", args, { stdin: "ignore", env: { GIT_TERMINAL_PROMPT: "0" } })
test(name, fn, 30_000)
```

TDD order (smallest first):

1. `worktree-store` git wrapper.
2. Event reducers.
3. Reconcile and migration.
4. Agent cwd binding.
5. HTTP/IPC handlers.
6. Client switcher and create/remove modals.
7. Mobile drawer.

Manual verification (per `CLAUDE.md` UI rule): start the dev server, exercise create / switch / remove / orphan / dirty paths in the browser before claiming the work complete.
