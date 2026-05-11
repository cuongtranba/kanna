# Stack Phase 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the UI surface for the Stack feature. Stacks become visible and manageable from the sidebar; chats can be created inside stacks with a per-project worktree picker; the chat header shows a persistent peer strip listing each bound worktree. Keyboard-first. Mobile parity. No new server behavior — Phase 1 + 2 already cover everything the UI calls.

**Architecture:** A new `stacks` array is added to the existing `SidebarData` snapshot (derived from the existing `stackSummaries` selector). `KannaSidebar.tsx` mounts a new `StacksSection` directly above `LocalProjectsSection`. Stack creation, rename, member-edit, and delete all happen via inline panels (no modals — PRODUCT.md rule). Stack-bound chat creation uses an inline table panel anchored to the stack row, with a per-project worktree dropdown and a primary radio. `PeerWorktreeStrip` is a small Mono-scale component appended to `ChatNavbar`; it renders from the existing `ChatSnapshot.resolvedBindings` field. Keybindings extend `keybindings.ts`. All visual tokens come from existing DESIGN.md.

**Tech Stack:** React 18 + TypeScript + Tailwind under Vite. Tests via `bun test` (DOM tests use the existing test setup; see `LocalProjectsSection.test.tsx` for the canonical pattern). WebSocket commands already shipped in Phase 1/2; client only needs to send them.

**Source spec:** `docs/plans/2026-05-11-stack-multi-repo-design.md` Section 3 (Client UI), revised. Phase 1+2 PRs #48, #50 merged into main.

**Pre-flight:**

```bash
git rev-parse --abbrev-ref HEAD                 # → feat/stack-phase3
git log -1 --oneline                            # 2295fc8 Phase 2 merge
bun test --timeout 30000                        # baseline 1224 pass / 0 fail
```

If anything is red, stop and ask.

**Out of scope (deferred):**

- Re-binding peer worktrees on a live chat (`chat_binding_changed`).
- Worktree branch + dirty enrichment on the peer strip (UI fetches via worktree-store on demand; out for now).
- Drag-and-drop reordering of stacks or stack members.
- Migration UX prompting users to convert two solo chats into a stack chat.
- Codex per-chat `codex: cwd-only` indicator copy refinement — ship a plain Mono label; iterate later.

---

## Task 1: Add `stacks` to `SidebarData` snapshot

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/read-models.ts`
- Modify: `src/server/read-models.test.ts`

**Step 1: Extend `SidebarData`**

```ts
export interface SidebarData {
  projectGroups: SidebarProjectGroup[]
  stacks: StackSummary[]
}
```

`stacks` is always present (empty array when no stacks exist) — keeps client narrowing simple.

**Step 2: Populate in `deriveSidebarData`**

Add a single line in the `return { ... }` block:

```ts
return {
  projectGroups,
  stacks: stackSummaries(state),
}
```

Reuse the existing `stackSummaries` selector. No new logic.

**Step 3: Test**

Add a test in `read-models.test.ts`:

```ts
test("deriveSidebarData includes stack summaries", () => {
  const state = createEmptyState()
  state.stacksById.set("s1", {
    id: "s1",
    title: "Integration",
    projectIds: ["p1", "p2"],
    createdAt: 1,
    updatedAt: 1,
  })
  const sidebar = deriveSidebarData(state, new Map())
  expect(sidebar.stacks).toHaveLength(1)
  expect(sidebar.stacks[0]?.title).toBe("Integration")
})
```

Run `bun test src/server/read-models.test.ts`. Expect green.

**Step 4: Verify ws-router broadcast surface**

`ws-router.ts` already serializes `SidebarData` through `broadcastFilteredSnapshots`. No change.

**Step 5: Commit**

```bash
git add src/shared/types.ts src/server/read-models.ts src/server/read-models.test.ts
git commit -m "feat(stacks): include stack summaries in SidebarData snapshot"
```

---

## Task 2: Surface `stacks` and stack commands in `useKannaState`

**Files:**
- Modify: `src/client/app/useKannaState.ts`

**Step 1: Read the hook**

It's 2200 lines. Find the public return object (search: `return {` near the end, ~line 2144) and the sidebar plumbing (search: `data.projectGroups`).

**Step 2: Add stacks to the surface**

Wherever the hook returns or memoizes `data.projectGroups`, also surface `data.stacks` (default to `[]` when snapshot absent). Add:

```ts
const stacks = data.stacks ?? []
```

Return `stacks` from the hook.

**Step 3: Add stack command helpers**

Following the existing pattern of WS command helpers in the file (search: `sendCommand({ type: "chat.create"` for the template), add:

```ts
const createStack = useCallback(async (title: string, projectIds: string[]) => {
  return sendCommand({ type: "stack.create", title, projectIds })
}, [sendCommand])

const renameStack = useCallback(async (stackId: string, title: string) => {
  return sendCommand({ type: "stack.rename", stackId, title })
}, [sendCommand])

const removeStack = useCallback(async (stackId: string) => {
  return sendCommand({ type: "stack.remove", stackId })
}, [sendCommand])

const addProjectToStack = useCallback(async (stackId: string, projectId: string) => {
  return sendCommand({ type: "stack.addProject", stackId, projectId })
}, [sendCommand])

const removeProjectFromStack = useCallback(async (stackId: string, projectId: string) => {
  return sendCommand({ type: "stack.removeProject", stackId, projectId })
}, [sendCommand])

const createStackChat = useCallback(async (
  primaryProjectId: string,
  stackId: string,
  stackBindings: Array<{ projectId: string; worktreePath: string; role: "primary" | "additional" }>,
) => {
  return sendCommand({ type: "chat.create", projectId: primaryProjectId, stackId, stackBindings })
}, [sendCommand])
```

Adjust to the actual signature `sendCommand` uses (look at `createChat` neighbor for the exact shape — the helper may return `chatId` from the ack).

Return all six from the hook.

**Step 4: Typecheck**

```bash
bun x tsc --noEmit 2>&1 | grep -v sonner | head
```

Expected: clean.

**Step 5: Commit**

```bash
git add src/client/app/useKannaState.ts
git commit -m "feat(stacks): surface stacks + stack command helpers in useKannaState"
```

---

## Task 3: `StacksSection` sidebar component (TDD)

**Files:**
- Create: `src/client/components/chat-ui/sidebar/StacksSection.tsx`
- Create: `src/client/components/chat-ui/sidebar/StacksSection.test.tsx`

**Step 1: Failing test**

Mirror the test pattern from `LocalProjectsSection.test.tsx` exactly (imports, render harness, RTL queries, `expect(screen.getByText(...))`).

Tests:

1. `renders empty state copy when stacks list is empty`.
2. `renders one row per stack with title and member-count badge`.
3. `expanding a stack row reveals its member project names inline (no tooltip)`.
4. `keyboard navigation: focus first stack row with tab; press Enter to expand`.
5. `+ Stack button is keyboard reachable`.
6. `disabled state when fewer than 2 projects exist with copy "Register a second project to create a stack"`.

Run: `bun test src/client/components/chat-ui/sidebar/StacksSection.test.tsx`. Expect FAIL.

**Step 2: Component shape**

```tsx
interface StacksSectionProps {
  stacks: StackSummary[]
  projects: Array<{ id: string; title: string }>          // for member-name reveal + disabled gate
  expandedStackIds: Set<string>
  onToggleExpanded: (stackId: string) => void
  onOpenCreatePanel: () => void                            // toggles the inline create panel (Task 4)
  onOpenStackMenu: (stackId: string) => void               // rename/remove projects/delete (Task 5)
  chats: SidebarChatRow[]                                  // for rendering nested chat rows under expanded stack
}
```

Tokens — DESIGN.md:
- Section header: Title scale, 600 weight, sentence case "Stacks". `+` button right-aligned, ghost button shape.
- Row: Title-scale title + Mono `tabular-nums` member-count badge in Margin Gray. Hover → Surface Secondary background. Focus ring per DESIGN.md.
- No left-border stripe. No icon prefix. No glyph chips. Inline member-name reveal under the row when expanded (Body scale, Margin Gray).
- Status indicators reuse the existing `ChatRow` for nested chats.

**Step 3: Commit**

```bash
git add src/client/components/chat-ui/sidebar/StacksSection.tsx \
        src/client/components/chat-ui/sidebar/StacksSection.test.tsx
git commit -m "feat(stacks): StacksSection sidebar component (calm, keyboard-first)"
```

---

## Task 4: Inline stack create + edit panel (TDD)

**Files:**
- Create: `src/client/components/chat-ui/sidebar/StackCreatePanel.tsx`
- Create: `src/client/components/chat-ui/sidebar/StackCreatePanel.test.tsx`

**Step 1: Tests**

1. `renders title input, multi-select chip list of projects, Save and Cancel`.
2. `Save is disabled when title empty or fewer than 2 projects selected`.
3. `Enter submits the form; Escape cancels`.
4. `populating projectIds + title and submitting calls onCreate with the right args`.
5. `edit mode prefills the title and selected chips`.
6. `single-project user sees the disabled banner "Register a second project to create a stack"`.

**Step 2: Component shape**

```tsx
interface StackCreatePanelProps {
  mode: "create" | "edit"
  initialTitle?: string
  initialProjectIds?: string[]
  projects: Array<{ id: string; title: string }>
  onSubmit: (title: string, projectIds: string[]) => Promise<void>
  onCancel: () => void
}
```

Inline panel (not a modal). Rendered conditionally inside `StacksSection`. Title input above, project chip list below, action row at bottom. Tab order: title → chips (arrow keys for chip toggle) → Save → Cancel. Cmd+Enter submits when chip list has focus too.

**Step 3: Commit**

```bash
git add src/client/components/chat-ui/sidebar/StackCreatePanel.tsx \
        src/client/components/chat-ui/sidebar/StackCreatePanel.test.tsx
git commit -m "feat(stacks): inline stack create/edit panel"
```

---

## Task 5: Stack action menu (rename, edit projects, delete)

**Files:**
- Modify: `src/client/components/chat-ui/sidebar/Menus.tsx` (reuse the existing menu shell)

**Step 1: Test**

Existing `Menus.tsx` tests if any — extend or add a `Menus.stack.test.tsx`. Cover:
- Menu items: Rename, Add projects, Remove projects, Delete.
- Delete confirms inline; never modal-on-modal.
- Each action is keyboard reachable from the stack row's `enter` press.

**Step 2: Wire actions**

Each action calls the `useKannaState` helpers added in Task 2. Rename + Add/Remove projects re-open the inline create panel (Task 4) in edit mode. Delete shows inline `"Delete <title>?"` confirm — destructive button uses DESIGN.md `button-destructive` token.

**Step 3: Commit**

```bash
git add src/client/components/chat-ui/sidebar/Menus.tsx \
        src/client/components/chat-ui/sidebar/Menus.stack.test.tsx
git commit -m "feat(stacks): stack action menu (rename, edit members, delete)"
```

---

## Task 6: Stack chat creation inline row (TDD)

**Files:**
- Create: `src/client/components/chat-ui/sidebar/StackChatCreateRow.tsx`
- Create: `src/client/components/chat-ui/sidebar/StackChatCreateRow.test.tsx`

**Step 1: Tests**

1. `renders one row per stack member with project title, worktree dropdown, primary radio`.
2. `worktree dropdown defaults to the project's primary worktree`.
3. `primary radio defaults to the first row`.
4. `Cmd+Enter submits; Esc collapses`.
5. `Submit calls createStackChat with { primaryProjectId, stackId, bindings[] }`.
6. `mobile (<640px viewport) renders the panel as a bottom sheet`.

**Step 2: Component shape**

```tsx
interface StackChatCreateRowProps {
  stack: StackSummary
  projects: Array<{ id: string; title: string; worktrees: WorktreeSummary[] }>
  onCreate: (args: {
    primaryProjectId: string
    stackBindings: Array<{ projectId: string; worktreePath: string; role: "primary" | "additional" }>
  }) => Promise<void>
  onCancel: () => void
}
```

Need to thread `WorktreeSummary[]` from somewhere. Phase 2 didn't expose worktrees in `SidebarData`. **Add to `SidebarProjectGroup`** a new field:

```ts
worktrees?: Array<{ path: string; branch: string; isPrimary: boolean }>
```

Server-side: extend `deriveSidebarData` to call `listWorktrees(project.localPath)` per project. This is an async git call — defer until requested via a dedicated WS subscription instead of blocking the sidebar derive. **Simpler approach: client requests worktrees per project on demand** when the chat-create row opens. Use a new WS command `stack.listWorktrees { projectId }` that returns `WorktreeSummary[]`.

> **Sub-task 6a:** add `stack.listWorktrees` WS command (one round-trip, returns the list). Server uses `listWorktrees(project.localPath)` from `worktree-store.ts`. Phase 2 plan does NOT call this; add it now.

**Step 3: Commit**

Two commits:

```bash
git add src/shared/protocol.ts src/server/ws-router.ts src/server/ws-router.stack.test.ts
git commit -m "feat(stacks): stack.listWorktrees WS command for per-project worktree picker"

git add src/client/components/chat-ui/sidebar/StackChatCreateRow.tsx \
        src/client/components/chat-ui/sidebar/StackChatCreateRow.test.tsx \
        src/client/app/useKannaState.ts
git commit -m "feat(stacks): inline stack chat creation row with per-project worktree picker"
```

---

## Task 7: `PeerWorktreeStrip` on chat header (TDD)

**Files:**
- Create: `src/client/components/chat-ui/PeerWorktreeStrip.tsx`
- Create: `src/client/components/chat-ui/PeerWorktreeStrip.test.tsx`
- Modify: `src/client/components/chat-ui/ChatNavbar.tsx`

**Step 1: Tests**

1. `renders nothing when resolvedBindings is undefined or has <=1 entry`.
2. `renders mono labels per binding with project@branch format (use worktreePath basename until branch is wired)`.
3. `primary binding shows a filled status dot`.
4. `peers with projectStatus: "missing" render greyed with a strike`.
5. `clicking a peer label opens an action menu (Open in Finder via external-open)`.
6. `Codex provider chat shows the inline "codex: cwd-only" label at the end`.

**Step 2: Shape**

```tsx
interface PeerWorktreeStripProps {
  bindings: ResolvedStackBinding[]
  provider: AgentProvider | null
  onOpenPath: (path: string) => void
}
```

DESIGN.md tokens:
- Mono scale, tabular-nums, single line below the chat title.
- Primary dot: Verified Sage (filled). Peers: Margin Gray (open circle).
- Missing peers: Margin Gray + line-through.
- No new color tokens; no glow; no pulse.
- Codex indicator: plain Mono label "codex: cwd-only" with no icon.

**Step 3: Mount in `ChatNavbar`**

Insert the strip directly under the chat title. Pass `resolvedBindings` from the chat snapshot.

**Step 4: Commit**

```bash
git add src/client/components/chat-ui/PeerWorktreeStrip.tsx \
        src/client/components/chat-ui/PeerWorktreeStrip.test.tsx \
        src/client/components/chat-ui/ChatNavbar.tsx
git commit -m "feat(stacks): PeerWorktreeStrip on chat header"
```

---

## Task 8: Sidebar mount + keybindings

**Files:**
- Modify: `src/client/app/KannaSidebar.tsx`
- Modify: `src/server/keybindings.ts`
- Modify: `src/server/keybindings.test.ts`

**Step 1: Mount `StacksSection`**

Above `LocalProjectsSection` in `KannaSidebar.tsx`. Pass `stacks`, `projects`, expanded state, and the stack handlers from `useKannaState`.

**Step 2: Keybindings**

Add three new bindings to `keybindings.ts`:

```ts
newStack: ["cmd+alt+w"]
newStackChat: ["cmd+alt+shift+n"]
jumpToStacks: ["g s"]
```

Wire `useKannaState` handlers to the binding events.

**Step 3: Tests**

- `keybindings.test.ts`: defaults include the three new actions.
- `KannaSidebar.test.tsx` (extend existing): pressing the keybinding focuses/opens the right surface.

**Step 4: Commit**

```bash
git add src/client/app/KannaSidebar.tsx src/server/keybindings.ts src/server/keybindings.test.ts
git commit -m "feat(stacks): mount StacksSection and wire keybindings (cmd+alt+w / cmd+alt+shift+n / g s)"
```

---

## Task 9: Empty states + Codex `codex: cwd-only` polish

**Files:**
- Modify: any of the new components for empty-state copy.
- Modify: `PeerWorktreeStrip.tsx` (Codex label).

Use the copy from the design doc verbatim:

- `StacksSection` empty: *"A stack groups projects so one chat can read and write across them. Add your first stack."*
- `StackCreatePanel` single-project disabled: *"Register a second project to create a stack"*
- Codex peer-strip label: `codex: cwd-only`

**Commit:**

```bash
git add src/client/components/chat-ui/sidebar/StacksSection.tsx \
        src/client/components/chat-ui/sidebar/StackCreatePanel.tsx \
        src/client/components/chat-ui/PeerWorktreeStrip.tsx
git commit -m "feat(stacks): editorial empty-state copy + Codex cwd-only indicator"
```

---

## Task 10: Mobile parity

**Files:**
- Modify: each create panel + peer strip to switch to mobile shape at `< 640px`.

Use the existing breakpoint hook (search: `useMediaQuery` or `useIsMobile` in the client). The inline panels collapse to bottom sheets on mobile. Peer strip wraps to two lines instead of overflowing.

**Commit:**

```bash
git add src/client/components/chat-ui/...
git commit -m "feat(stacks): mobile bottom-sheet variants for stack panels"
```

---

## Task 11: Accessibility audit + WCAG check

Manual checklist before push:

- All actions reachable from keyboard.
- Visible focus ring on every new interactive element.
- Color is never the only signal: peer primary = dot + Sage; missing = strike + Margin Gray.
- Tabular-nums on the member-count badge.
- `prefers-reduced-motion`: any panel expand animation disabled.
- Contrast meets ≥ 4.5:1 on every new label against its surface.

Run the `skill-stack:wcag-verify` skill on the changed files if available. Fix anything it flags.

No commit — quality gate only.

---

## Task 12: Full-suite verification + push

```bash
bun test --timeout 30000
bun x tsc --noEmit 2>&1 | grep -v sonner | head
bun run build                                 # vite build must pass (CI runs this)
```

Then push and open PR:

```bash
git push -u origin feat/stack-phase3
gh pr create --repo cuongtranba/kanna --base main --head feat/stack-phase3 \
  --title "feat(stacks): Phase 3 — sidebar UI, chat creation, peer strip" \
  --body "$(cat <<'EOF'
## Summary
- Adds StacksSection above LocalProjectsSection in the sidebar.
- Inline stack create/edit panel (no modal — PRODUCT.md rule).
- Inline stack chat creation row with per-project worktree dropdown + primary radio.
- PeerWorktreeStrip below the chat title; renders \`resolvedBindings\` from chat snapshot.
- Keybindings: \`cmd+alt+w\` new stack, \`cmd+alt+shift+n\` new stack chat, \`g s\` jump to stacks.
- New WS command \`stack.listWorktrees\` returns per-project worktrees on demand.
- Codex provider chats show a \`codex: cwd-only\` Mono label on the strip.

## Test plan
- [x] bun test --timeout 30000 green.
- [x] vite build green.
- [x] tsc clean (sonner pre-existing only).
- [x] DOM tests for every new component.
- [x] Keybindings test covers the three new actions.
- [ ] Manual: round-trip create stack → create stack chat → confirm peer strip + agent receives additionalDirectories.
- [ ] Manual mobile: every panel renders as bottom sheet at <640px.

## Out of scope (later)
- Re-bind peer worktrees on a live chat (\`chat_binding_changed\`).
- Branch + dirty enrichment on the peer strip.
- Drag-and-drop reordering of stacks.
EOF
)"
```

---

## Done-when checklist

- [ ] 1 + Task 1 commit landed.
- [ ] Tasks 2–10 commits landed.
- [ ] All new components have DOM tests.
- [ ] `bun test --timeout 30000` green.
- [ ] `bun run build` (vite) green.
- [ ] PR open against `main`.
- [ ] Manual round-trip captured in PR description.

## Notes for the executor

- **No new visual tokens.** Reuse DESIGN.md scales, colors, spacing. No new icon, no new color, no glow.
- **No modals.** Inline everywhere.
- **Strong typing.** No `any` outside test fixtures.
- **Tooltip component.** If a hover-explanation is needed anywhere, use the project `Tooltip`, never native `title`.
- **Pre-existing failures.** `bun test` may flake on uploads/diff-store under concurrent load; use `--timeout 30000` to match CI.
- **agent.ts:** no changes. Server already handles `additionalDirectories` and Codex fallback.
- **Keep PRs small if context tightens** — split Task 6 (chat create + listWorktrees) into its own PR if needed.
