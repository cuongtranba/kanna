# Navbar Worktree Label

## Problem

Chat navbar shows only the current branch name. When user runs multiple chats
across different worktrees of the same repo (common with the stack feature),
nothing in the chat header indicates which worktree directory the chat is
operating in. The `localPath` prop is already passed to `ChatNavbar` but is
only used as a visibility gate for action buttons — it is never displayed.

## Goal

Surface the worktree directory name next to the branch name in the chat
navbar so the user can tell at a glance which worktree the current chat is
working in.

## Design

In `src/client/components/chat-ui/ChatNavbar.tsx`:

- Compute `worktreeDir = localPath?.split("/").pop()` when `localPath` set.
- Replace the `branchLabel` rendering inside the right-sidebar toggle button
  with a combined label: `<worktreeDir> · <branchName>`.
- Wrap the label in a `Tooltip` showing the full `localPath`.

Separator: ` · ` (middle dot with surrounding spaces).

### Label resolution rules

| `hasGitRepo` | `localPath` | `branchName`     | Rendered label                |
|--------------|-------------|------------------|-------------------------------|
| `false`      | any         | any              | `Setup Git` (unchanged)       |
| `true`       | set         | set              | `<dir> · <branch>`            |
| `true`       | set         | unset (detached) | `<dir> · Detached HEAD`       |
| `true`       | unset       | set              | `<branch>` (current behavior) |
| `true`       | unset       | unset            | `Detached HEAD`               |
| `true`       | any         | gitStatus unknown| nothing (current behavior)    |

### Truncation

The existing `max-w-[140px] truncate` class on the label `<div>` still
applies. Worktree dir names are usually short; if combined label overflows,
truncation keeps the leading worktree name visible (branch tail clipped).
Full path + full branch always available via tooltip.

### No backend changes

`localPath` already flows from `state.navbarLocalPath` into the navbar.
`branchName` already flows from `state.chatDiffSnapshot.branchName`. No new
data fetches.

## Edge cases

- `localPath` ending in `/` → `split("/").pop()` returns `""`; fall back to
  branch-only rendering when `worktreeDir` is empty.
- `localPath` is a Windows path with `\\` separators → use the last segment
  after either separator. Use a regex split (`/[/\\]/`) to be safe.

## Testing

New file `src/client/components/chat-ui/ChatNavbar.test.tsx`. Cases:

1. Renders `<dir> · <branch>` when both supplied.
2. Renders branch only when `localPath` unset.
3. Renders worktree dir only when `branchName` unset.
4. Renders `Setup Git` when `hasGitRepo === false`.
5. Renders nothing when `gitStatus === "unknown"`.

Uses existing `@testing-library/react` setup (other client tests under
`src/client/components/chat-ui/*.test.tsx` confirm pattern).

## Out of scope

- Sidebar chat-row worktree display.
- Highlighting current worktree inside `PeerWorktreeStrip` (already done via
  `role === "primary"`).
- Backend changes to worktree resolution.

## Files touched

- `src/client/components/chat-ui/ChatNavbar.tsx` — render combined label, add Tooltip.
- `src/client/components/chat-ui/ChatNavbar.test.tsx` — new tests.
- `src/server/paths-route.test.ts` — unrelated flaky-test fix (add 30s
  timeouts per CLAUDE.md guidance) bundled in this branch.
