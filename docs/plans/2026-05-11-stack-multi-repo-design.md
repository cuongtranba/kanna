# Stacks: Multi-Repo Chats Across Projects

**Date:** 2026-05-11
**Status:** Design

## Problem

Kanna users doing integration work across separate git repositories (typical case: backend repo + frontend repo) cannot drive a single agent that reads and writes across both. Today a project resolves to one `localPath` (`src/server/event-store.ts:763`) and a chat inherits that path as its `cwd` (`src/server/agent.ts:101, 1192`). The only workaround is to keep two Kanna projects open side by side, switch chats by hand, and copy context between them. There is no shared scope, no shared agent, and no way to ask one agent to land a coordinated change on both repos.

Worktrees (shipped phase 1 in commit `8c1553c`) solved the single-repo parallel-work case but did not touch the multi-repo case.

## Goal

Let a single chat span multiple registered Kanna projects, each on its own worktree, so an agent can perform integration tasks across them. Stay backwards-compatible: solo project flow unchanged.

## Naming

The feature is called **Stack**. A stack is a named group of existing Kanna projects. The word `workspace` is reserved for the existing PRODUCT.md framing of Kanna itself as a "navigable workspace"; using it for this feature would collide. Stack is short, editorial, distinct.

## Scope

In scope:

- A new top-level `Stack` entity that groups two or more existing projects.
- A new `StacksSection` in the sidebar above the projects section.
- Inline (non-modal) stack creation and edit panels.
- Stack chat creation with per-project worktree binding and a primary radio selecting the cwd repo.
- Agent spawn wires: primary binding to `cwd`, peer bindings to Claude SDK `additionalDirectories`.
- Persistent peer-worktree strip in the chat header (replaces the rejected hover-tooltip approach).
- Keybindings for new stack, new stack chat, and jump-to-stacks.
- Codex fallback: single `cwd` only; per-write `grantRoot` approvals.
- Mobile parity via bottom-sheet variant of the inline panel.

Out of scope (YAGNI; P2 follow-ups):

- Editing peer bindings on a live chat (`chat_binding_changed`).
- Swapping the primary repo mid-session.
- Cross-repo diff comparison.
- Codex multi-root via symlink or chroot tricks.
- Reverse-lookup chip on project rows (dropped after critique).
- Auto-detection of "related" repos (sibling dirs, monorepo siblings).

## Architecture

### Data model — event store

Append-only events in `src/server/events.ts`:

```ts
stack_added             { stackId, title, createdAt }
stack_removed           { stackId, removedAt }
stack_renamed           { stackId, title }
stack_project_added     { stackId, projectId, addedAt }
stack_project_removed   { stackId, projectId, removedAt }
```

Derived read model:

```ts
type Stack = {
  id: string
  title: string
  projectIds: string[]   // insertion order; drives sidebar order
  createdAt: number
}
```

Chat extension. No new event type. `chat_created` gains optional fields:

```ts
chat_created {
  // existing...
  stackId?: string
  stackBindings?: Array<{
    projectId: string
    worktreePath: string
    role: "primary" | "additional"
  }>
}
```

Invariants:

- `stackId` set ⇔ `stackBindings` set and non-empty.
- Exactly one `role: "primary"` per chat.
- Every binding's `projectId` is a current member of the stack at chat-creation time.
- Replay rule: chats without `stackId` resolve as today via `projectId` + `worktreePath`. No backfill event needed.

### Server module — `src/server/stack-store.ts`

```ts
class StackStore {
  createStack(title: string, projectIds: string[]): Stack    // ≥2 projects required
  renameStack(id: string, title: string): void
  removeStack(id: string): void                              // blocked if live chats reference it
  addProject(stackId: string, projectId: string): void
  removeProject(stackId: string, projectId: string): void    // blocked if any live chat binds it
  listStacks(): Stack[]
  getStack(id: string): Stack | null
}
```

Pure event-sourced, mirrors the shape of `src/server/worktree-store.ts`. Test file `stack-store.test.ts` covers create/rename/add/remove/delete and replay determinism.

### Agent spawn — `src/server/agent.ts`

At every spawn site (today `agent.ts:662` and `agent.ts:1192`):

1. If chat has no `stackBindings`, take the existing solo path. No change.
2. Else, find the binding with `role: "primary"`. Resolve `{projectId, worktreePath}` to an absolute path via `worktree-store`. Use it as `cwd`.
3. Map the remaining bindings to absolute paths. Pass them as `additionalDirectories: string[]` to the Claude Agent SDK `query()` call (verified to exist in the SDK; see Section 3 below).
4. Codex path: set `cwd` to the same primary path. Do not pass any extra root field; Codex App Server has no `additionalDirectories` equivalent. Cross-root writes surface as the native `grantRoot` approval per file change.
5. Persist the resolved primary + peer paths in the spawn event for replay and debugging.

### Read models — `src/server/read-models.ts`

- New derived selector `stackSummaries(): StackSummary[]` with member project ids and chat counts.
- Existing chat snapshot extended with:

  ```ts
  resolvedBindings: Array<{
    projectId: string
    projectTitle: string
    worktreePath: string
    worktreeBranch: string
    role: "primary" | "additional"
    status: "active" | "orphaned"
  }>
  ```

  Client renders the peer strip directly from this; no extra round-trip.

### WebSocket router — `src/server/ws-router.ts`

New commands:

- `createStack { title, projectIds }`
- `renameStack { stackId, title }`
- `removeStack { stackId }`
- `addStackProject { stackId, projectId }`
- `removeStackProject { stackId, projectId }`

`createChat` extended to accept optional `{ stackId, stackBindings }`. Validation: stack exists, every `projectId` is a current member, every `worktreePath` belongs to its project, exactly one primary.

### SDK verification

Claude Agent SDK `query()` options include `additionalDirectories: string[]` (verified via Context7 docs, source: `nothflare/claude-agent-sdk-docs/docs/en/agent-sdk/typescript.md`). Default `[]`. Sandbox honors entries as additional roots Claude can read and write.

Codex App Server protocol (`src/server/codex-app-server-protocol.ts`) exposes only `cwd` on `ThreadStartParams` / `ThreadResumeParams` / `ThreadForkParams`. The `grantRoot` field on `FileChangeRequestApprovalParams` is a per-approval runtime grant; it is the fallback path for cross-root writes when running a stack chat on Codex.

## Client UI

### Sidebar

`src/client/app/KannaSidebar.tsx` mounts a new `StacksSection` above `LocalProjectsSection`. Same row rhythm and tokens as projects, drawn from DESIGN.md (Title / Body / Label / Mono scales; Surface Secondary on hover; status dot conventions).

Stack row layout:

- Title (Title scale, weight 600).
- Member-count badge (Label scale, Mono nums).
- Caret. Expanded row shows the stack's chats, not its member projects.
- On hover or keyboard focus, an inline reveal under the row lists member project names (Body scale, Margin Gray). No tooltip. No directional glyph chip. Project rows are unchanged; reverse-lookup lives here.

Empty state copy: *"A stack groups projects so one chat can read and write across them. Add your first stack."*

### Stack creation and edit (inline, not modal)

`+ Stack` button in the section header expands an inline panel directly under it. The panel contains:

- Title input.
- Multi-select project chips (existing project list). At least two required.
- Save (Enter) and Cancel (Esc).

Users with only one registered project see the panel in a disabled state with copy *"Register a second project to create a stack"* linking to the existing add-project flow.

Edit uses the same panel, prefilled, opened from a row-level action menu (Rename, Add projects, Remove projects, Delete). All actions are keyboard-reachable; destructive actions confirm inline, never modal-on-modal (DESIGN.md ban).

### Stack chat creation (inline, not modal)

A `+ Chat` row sits at the bottom of an expanded stack, mirroring the per-project "new chat" pattern. Clicking expands a compact table:

```
Project        Worktree                Primary
backend        feat-auth      ▾        ●
frontend       main           ▾        ○
```

- The worktree dropdown defaults to the project's primary worktree.
- The primary radio defaults to the first row.
- Cmd+Enter submits; Esc collapses.
- Mobile (<640px viewport): same fields render as a bottom sheet.

### Chat header peer strip

`PeerWorktreeStrip.tsx` renders below the chat title in `ChatHeader.tsx` whenever `resolvedBindings.length > 1`. Format:

```
backend@feat-auth ●   frontend@main
```

- Mono scale, tabular numerics.
- Filled dot marks the primary (cwd).
- Orphaned bindings render in Margin Gray with a strike.
- Click on a peer label opens a small action menu (open dir in OS file manager via `external-open.ts`). Re-bind action deferred to P2.
- For Codex provider chats, a small Mono label `codex: cwd-only` appears at the end of the strip. No icon, no color alarm. Calm.

### Keybindings

Added to `src/server/keybindings.ts` and the client mirror:

- `cmd+alt+w` — new stack.
- `cmd+alt+shift+n` — new chat in focused stack.
- `g s` — jump to stacks section.
- Stack action menu reachable via `enter` on focused row; destructive actions confirmable from the keyboard.

## Data flow & edge cases

| Case | Behavior |
|---|---|
| Member project removed while stack chat is live | Chat marked `orphaned-binding`. Peer strip greys that label. Agent still spawns and skips the dead path in `additionalDirectories`. New chat creation blocked until binding fixed. |
| Worktree of a peer disappears on disk | Mark binding `orphaned`. Same handling. Reuses existing `worktree-store` orphan detection. |
| Worktree of primary disappears | Chat enters `cannot-spawn`. Header banner: *"Primary worktree missing. Restore or fork chat."* Existing missing-worktree banner reused. |
| Stack deleted with live chats | `removeStack` blocked. Toast: *"Stack has N active chats. Archive or stop them first."* |
| User adds the same project twice | Event-store rejects. UI multi-select prevents it. |
| Two bindings resolve to the same disk path | Allowed (different worktrees of the same repo). No dedupe in `additionalDirectories`. |
| `stackBindings` empty but `stackId` set | Event-store rejects. Replay treats malformed chat as legacy solo and drops `stackId`. |
| Two stack chats writing to the same peer worktree | Allowed. The existing `runGit` mutex in `src/server/diff-store.ts` already serializes per-repo. |
| Stack with zero member projects after removals | `removeProject` blocked when it would drop members below 2. |

## Testing

`bun test` must stay green before push. Specific suites:

- `src/server/stack-store.test.ts` — create, rename, add, remove, delete, replay determinism, invariants.
- `src/server/agent.test.ts` extensions — spawn with bindings sets `cwd` + `additionalDirectories` correctly; orphaned bindings skipped; Codex path drops additional dirs; `cwd` matches primary.
- `src/server/read-models.test.ts` — stack snapshot shape; `resolvedBindings` populated on chat snapshot; orphan status reflected.
- `src/server/ws-router.test.ts` — new commands enforce auth and validation.
- Client: `StacksSection.test.tsx` covers expand/collapse, member reveal on focus, empty state, single-project disabled state. `PeerWorktreeStrip.test.tsx` covers primary dot, orphan strike, Codex cwd-only label.

Subprocess hygiene rules from `CLAUDE.md` apply to any new git spawns: `stdin: "ignore"`, `GIT_TERMINAL_PROMPT=0`, explicit `30_000` ms test timeout.

## Rollout phases

1. **Phase 1 — server + store.** `stack-store.ts`, events, read-model selectors, ws-router commands. No UI. Tests green.
2. **Phase 2 — agent spawn wiring.** Bindings to `cwd` + `additionalDirectories`. Codex fallback. `agent.test.ts` extensions.
3. **Phase 3 — UI.** `StacksSection`, inline create panel, stack chat creation row, peer strip, keybindings.
4. **Phase 4 — polish.** Empty states, orphan banners, Codex cwd-only label, mobile sheet variant. `/impeccable polish` pass.

Each phase ships its own PR against `cuongtranba/kanna`. Phase 1+2 are mergeable behind the absence of UI; Phase 3 ships the feature.

## File map

New:

```
src/server/stack-store.ts
src/server/stack-store.test.ts
src/client/components/chat-ui/sidebar/StacksSection.tsx
src/client/components/chat-ui/sidebar/StacksSection.test.tsx
src/client/components/chat-ui/sidebar/StackCreatePanel.tsx
src/client/components/chat-ui/sidebar/StackChatCreateRow.tsx
src/client/components/chat-ui/chat-header/PeerWorktreeStrip.tsx
src/client/components/chat-ui/chat-header/PeerWorktreeStrip.test.tsx
```

Modified:

```
src/server/events.ts                  + stack_* event types
src/server/read-models.ts             + stack snapshot, resolvedBindings
src/server/ws-router.ts               + stack commands, extend createChat
src/server/agent.ts                   spawn site: bindings → cwd + additionalDirectories (lines ~662, ~1192)
src/server/codex-app-server.ts        cwd matches primary binding (no field changes)
src/server/keybindings.ts             + new bindings
src/shared/types.ts                   + Stack, StackBinding, SidebarStackGroup; extend Chat
src/shared/protocol.ts                + new WS commands
src/client/app/KannaSidebar.tsx       mount StacksSection above LocalProjectsSection
src/client/app/useKannaState.ts       consume stack snapshot
src/client/components/chat-ui/ChatHeader.tsx   render PeerWorktreeStrip when resolvedBindings.length > 1
```

## Documentation updates after merge

- `DESIGN.md` adds Stack row + `PeerWorktreeStrip` entries.
- `.c3/` adds a ref linking `stack-store` ↔ `agent` ↔ `ws-router`.
- `CHANGELOG.md` entry on release.

## Open questions

None blocking. P2 items above can be designed after Phase 3 ships and the peer-rebinding need is real, not speculative.

## Phase 2 amendments (post-implementation)

Phase 2 bound stacks by `worktreePath` rather than `worktreeId` because worktree state is not yet in the event store (the `feat/worktree-events` branch is plan-only). The chat snapshot exposes `resolvedBindings` with project title and active/missing status; worktree branch and dirty status are deferred to Phase 3 (UI fetches via `worktree-store` on demand). When `feat/worktree-events` lands, a follow-up migration can resolve paths to ids without breaking the on-disk event log (the `worktreePath` field stays as a stable secondary key).

Architectural note carried from Phase 1: stack state lives inside `event-store.ts` alongside projects and chats, not in a separate `stack-store.ts` module. The phase plan corrected the design doc on this point.
