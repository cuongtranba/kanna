# Star Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users star projects so they appear in a dedicated "Starred" section at the top of the sidebar, ordered by most recently starred.

**Architecture:** Event-sourced. Add optional `starredAt?: number` to `ProjectRecord` (mirrors `archivedAt` / `deletedAt` pattern). Single new event `project_star_set` toggles the timestamp. Read model partitions sidebar into `starredProjectGroups` (sorted desc by `starredAt`) and existing `projectGroups`. Client renders a new Starred section above the project list; star/unstar via context menu only.

**Tech Stack:** Bun, TypeScript, React, Zustand, dnd-kit, lucide-react, Tailwind, Bun test.

**Spec:** `docs/superpowers/specs/2026-05-13-star-projects-design.md`

---

## File Structure

**Modify:**
- `src/server/events.ts` — add `starredAt?: number` to `ProjectRecord`, add `project_star_set` event variant
- `src/server/event-store.ts` — reducer case, replay priority, `setProjectStar()` method
- `src/server/event-store.test.ts` — apply/replay tests
- `src/shared/types.ts` — add `starredAt?: number` to `SidebarProjectGroup`, add `starredProjectGroups` to `SidebarData`
- `src/shared/protocol.ts` — add `project.setStar` to `ClientCommand`
- `src/server/read-models.ts` — partition starred vs main
- `src/server/read-models.test.ts` — partition + sort tests
- `src/server/ws-router.ts` — handler for `project.setStar`
- `src/server/ws-router.test.ts` — command handler tests
- `src/client/app/useKannaState.ts` — thread `starredProjectGroups` through state hook
- `src/client/components/chat-ui/sidebar/Menus.tsx` — add `starred` + `onToggleStar` props to `ProjectSectionMenu`, render entry
- `src/client/components/chat-ui/sidebar/LocalProjectsSection.tsx` — render Starred section above main list
- `src/client/components/chat-ui/sidebar/LocalProjectsSection.test.tsx` — render tests

**Create:**
- `src/client/components/chat-ui/sidebar/Menus.test.tsx` — context menu tests (new file; existing `Menus.stack.test.tsx` is stack-specific)

---

## Task 1: Server data model — `ProjectRecord.starredAt` and event type

**Files:**
- Modify: `src/server/events.ts:4-6` and `:67-84`

- [ ] **Step 1: Add `starredAt` to `ProjectRecord`**

Edit `src/server/events.ts:4-6`:

```ts
export interface ProjectRecord extends ProjectSummary {
  deletedAt?: number
  starredAt?: number
}
```

- [ ] **Step 2: Add `project_star_set` event variant**

Edit `src/server/events.ts:67-84` to extend `ProjectEvent`:

```ts
export type ProjectEvent = {
  v: 3
  type: "project_opened"
  timestamp: number
  projectId: string
  localPath: string
  title: string
} | {
  v: 3
  type: "project_removed"
  timestamp: number
  projectId: string
} | {
  v: 3
  type: "sidebar_project_order_set"
  timestamp: number
  projectIds: string[]
} | {
  v: 3
  type: "project_star_set"
  timestamp: number
  projectId: string
  starredAt: number | null
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run check 2>&1 | head -40`
Expected: no errors related to `events.ts` (downstream switch statements in `event-store.ts` may now flag missing case — fix in Task 2).

- [ ] **Step 4: Commit**

```bash
git add src/server/events.ts
git commit -m "feat(server): add starredAt to ProjectRecord and project_star_set event"
```

---

## Task 2: Event reducer + replay priority

**Files:**
- Modify: `src/server/event-store.ts:84-138` (replay priority) and `:495-526` (reducer)
- Modify: `src/server/event-store.test.ts` (new test cases)

- [ ] **Step 1: Write failing test for star/unstar apply**

Append to `src/server/event-store.test.ts` inside the appropriate `describe` block (existing project event tests — search for `"project_opened"` to find the right spot):

```ts
test("applies project_star_set with timestamp", async () => {
  const tmp = await tmpDataDir()
  const store = await createTestStore(tmp)
  const project = await store.openProject(path.join(tmp, "proj-a"))

  await store.setProjectStar(project.id, true)

  const after = store.getProject(project.id)!
  expect(after.starredAt).toBeGreaterThan(0)
})

test("applies project_star_set with null clears starredAt", async () => {
  const tmp = await tmpDataDir()
  const store = await createTestStore(tmp)
  const project = await store.openProject(path.join(tmp, "proj-a"))
  await store.setProjectStar(project.id, true)

  await store.setProjectStar(project.id, false)

  const after = store.getProject(project.id)!
  expect(after.starredAt).toBeUndefined()
})

test("starredAt survives replay", async () => {
  const tmp = await tmpDataDir()
  const store = await createTestStore(tmp)
  const project = await store.openProject(path.join(tmp, "proj-a"))
  await store.setProjectStar(project.id, true)
  const starredAtBefore = store.getProject(project.id)!.starredAt

  await store.close()
  const reloaded = await createTestStore(tmp)

  expect(reloaded.getProject(project.id)!.starredAt).toBe(starredAtBefore)
})
```

If `tmpDataDir`, `createTestStore`, or related helpers have different names in this file, match the existing test helpers — copy the setup pattern from an existing `project_removed` test in the same file.

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test src/server/event-store.test.ts 2>&1 | tail -20`
Expected: 3 failures — `store.setProjectStar is not a function` (or similar).

- [ ] **Step 3: Add replay priority for new event**

Edit `src/server/event-store.ts:84-90` — extend the `project_*` case group:

```ts
function getReplayEventPriority(event: StoreEvent): number {
  const discriminator = "type" in event ? event.type : event.kind
  switch (discriminator) {
    case "project_opened":
    case "project_removed":
    case "sidebar_project_order_set":
    case "project_star_set":
      return 0
    // ... rest unchanged
```

- [ ] **Step 4: Add reducer case**

Edit `src/server/event-store.ts:523-526` (immediately after the `sidebar_project_order_set` case):

```ts
case "sidebar_project_order_set": {
  this.state.sidebarProjectOrder = [...e.projectIds]
  break
}
case "project_star_set": {
  const project = this.state.projectsById.get(e.projectId)
  if (!project) break
  if (e.starredAt == null) {
    delete project.starredAt
  } else {
    project.starredAt = e.starredAt
  }
  project.updatedAt = e.timestamp
  break
}
```

- [ ] **Step 5: Add `setProjectStar` store method**

Edit `src/server/event-store.ts` — add immediately after `removeProject` (around `:867`):

```ts
async setProjectStar(projectId: string, starred: boolean) {
  const project = this.getProject(projectId)
  if (!project) {
    throw new Error("Project not found")
  }
  const event: ProjectEvent = {
    v: STORE_VERSION,
    type: "project_star_set",
    timestamp: Date.now(),
    projectId,
    starredAt: starred ? Date.now() : null,
  }
  await this.append(this.projectsLogPath, event)
}
```

- [ ] **Step 6: Run tests — verify pass**

Run: `bun test src/server/event-store.test.ts 2>&1 | tail -10`
Expected: all 3 new tests pass, existing tests still green.

- [ ] **Step 7: Commit**

```bash
git add src/server/events.ts src/server/event-store.ts src/server/event-store.test.ts
git commit -m "feat(event-store): reduce project_star_set and add setProjectStar"
```

---

## Task 3: WS protocol + command handler

**Files:**
- Modify: `src/shared/protocol.ts:70-85`
- Modify: `src/server/ws-router.ts` (around `:1371-1380`)
- Modify: `src/server/ws-router.test.ts`

- [ ] **Step 1: Add `project.setStar` to `ClientCommand`**

Edit `src/shared/protocol.ts:74` — add new variant in the union (insert after `project.remove`):

```ts
| { type: "project.remove"; projectId: string }
| { type: "project.setStar"; projectId: string; starred: boolean }
```

- [ ] **Step 2: Write failing test for command handler**

Append to `src/server/ws-router.test.ts` (find an existing project command test, e.g. for `project.remove`, and mirror its setup):

```ts
test("project.setStar appends event and rebroadcasts sidebar", async () => {
  const harness = await createWsRouterHarness()
  const project = await harness.store.openProject(path.join(harness.dataDir, "proj-a"))

  await harness.sendCommand({ type: "project.setStar", projectId: project.id, starred: true })

  expect(harness.store.getProject(project.id)!.starredAt).toBeGreaterThan(0)
  expect(harness.lastSidebarBroadcast()).toBeTruthy()
})

test("project.setStar with starred=false clears the field", async () => {
  const harness = await createWsRouterHarness()
  const project = await harness.store.openProject(path.join(harness.dataDir, "proj-a"))
  await harness.store.setProjectStar(project.id, true)

  await harness.sendCommand({ type: "project.setStar", projectId: project.id, starred: false })

  expect(harness.store.getProject(project.id)!.starredAt).toBeUndefined()
})

test("project.setStar rejects unknown projectId", async () => {
  const harness = await createWsRouterHarness()

  await expect(
    harness.sendCommand({ type: "project.setStar", projectId: "missing", starred: true })
  ).rejects.toThrow(/Project not found/)
})
```

If `createWsRouterHarness` / `harness.sendCommand` / `harness.lastSidebarBroadcast` have different names, mirror the existing harness usage in this file. Search for `"project.remove"` test to find conventions.

- [ ] **Step 3: Run tests — verify fail**

Run: `bun test src/server/ws-router.test.ts 2>&1 | tail -20`
Expected: 3 failures — no `project.setStar` case in handler.

- [ ] **Step 4: Add handler case**

Edit `src/server/ws-router.ts` — insert after the `project.remove` case (around `:1380`):

```ts
case "project.setStar": {
  await store.setProjectStar(command.projectId, command.starred)
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id })
  await broadcastFilteredSnapshots({ includeSidebar: true })
  return
}
```

- [ ] **Step 5: Run tests — verify pass**

Run: `bun test src/server/ws-router.test.ts 2>&1 | tail -10`
Expected: all 3 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/protocol.ts src/server/ws-router.ts src/server/ws-router.test.ts
git commit -m "feat(ws): add project.setStar command"
```

---

## Task 4: Sidebar types + read model partition

**Files:**
- Modify: `src/shared/types.ts:463-476`
- Modify: `src/server/read-models.ts:91-140`
- Modify: `src/server/read-models.test.ts`

- [ ] **Step 1: Update shared types**

Edit `src/shared/types.ts:463-471`:

```ts
export interface SidebarProjectGroup {
  groupKey: string
  localPath: string
  chats: SidebarChatRow[]
  previewChats: SidebarChatRow[]
  olderChats: SidebarChatRow[]
  archivedChats?: SidebarChatRow[]
  defaultCollapsed: boolean
  starredAt?: number
}
```

Edit `src/shared/types.ts:473-476`:

```ts
export interface SidebarData {
  starredProjectGroups: SidebarProjectGroup[]
  projectGroups: SidebarProjectGroup[]
  stacks: StackSummary[]
}
```

- [ ] **Step 2: Write failing test for read-model partition**

Append to `src/server/read-models.test.ts`:

```ts
test("starred projects appear in starredProjectGroups only, sorted desc by starredAt", () => {
  const state = makeStateWithProjects([
    { id: "p1", localPath: "/a", starredAt: 1000 },
    { id: "p2", localPath: "/b" },
    { id: "p3", localPath: "/c", starredAt: 2000 },
  ])

  const sidebar = deriveSidebarData(state, { nowMs: 5000 })

  expect(sidebar.starredProjectGroups.map((g) => g.groupKey)).toEqual(["p3", "p1"])
  expect(sidebar.projectGroups.map((g) => g.groupKey)).toEqual(["p2"])
})

test("starred ties broken deterministically by projectId", () => {
  const state = makeStateWithProjects([
    { id: "p2", localPath: "/b", starredAt: 1000 },
    { id: "p1", localPath: "/a", starredAt: 1000 },
  ])

  const sidebar = deriveSidebarData(state, { nowMs: 5000 })

  expect(sidebar.starredProjectGroups.map((g) => g.groupKey)).toEqual(["p1", "p2"])
})

test("unstarred project returns to projectGroups", () => {
  const state = makeStateWithProjects([
    { id: "p1", localPath: "/a" },
    { id: "p2", localPath: "/b" },
  ])

  const sidebar = deriveSidebarData(state, { nowMs: 5000 })

  expect(sidebar.starredProjectGroups).toEqual([])
  expect(sidebar.projectGroups.map((g) => g.groupKey).sort()).toEqual(["p1", "p2"])
})
```

If the test helper is named `makeState` or similar in this file, match what's there. Search this file for an existing `deriveSidebarData` test to copy fixture setup.

- [ ] **Step 3: Run — verify fail**

Run: `bun test src/server/read-models.test.ts 2>&1 | tail -20`
Expected: failures referencing `starredProjectGroups` undefined.

- [ ] **Step 4: Partition in read-model**

Edit `src/server/read-models.ts:124-140` — replace the existing `projectGroups` / return statement:

```ts
const allGroups: SidebarProjectGroup[] = projects.map((project) => {
  const chats = toSidebarChatRows(project, chatsByProjectId.get(project.id) ?? [])
  const archivedChats = toSidebarChatRows(project, archivedChatsByProjectId.get(project.id) ?? [])
  const { previewChats, olderChats } = getSidebarChatBuckets(chats, nowMs)

  return {
    groupKey: project.id,
    localPath: project.localPath,
    chats,
    previewChats,
    olderChats,
    ...(archivedChats.length ? { archivedChats } : {}),
    defaultCollapsed: chats.every((chat) => !isSidebarChatRecent(chat, nowMs)),
    ...(project.starredAt != null ? { starredAt: project.starredAt } : {}),
  }
})

const starredProjectGroups = allGroups
  .filter((g) => g.starredAt != null)
  .sort((a, b) => {
    const diff = (b.starredAt ?? 0) - (a.starredAt ?? 0)
    if (diff !== 0) return diff
    return a.groupKey.localeCompare(b.groupKey)
  })
const projectGroups = allGroups.filter((g) => g.starredAt == null)

return { starredProjectGroups, projectGroups, stacks: stackSummaries(state) }
```

- [ ] **Step 5: Run — verify pass**

Run: `bun test src/server/read-models.test.ts 2>&1 | tail -10`
Expected: all new tests pass.

- [ ] **Step 6: Full server suite**

Run: `bun test src/server 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/server/read-models.ts src/server/read-models.test.ts
git commit -m "feat(read-models): partition sidebar into starredProjectGroups"
```

---

## Task 5: Client state hook plumbing

**Files:**
- Modify: `src/client/app/useKannaState.ts`

- [ ] **Step 1: Locate sidebar consumer**

The hook destructures `sidebar.projectGroups` to expose to UI. Search for `projectGroups` in `useKannaState.ts` to find the consumption site. There are likely 2-3 references (state selector, exported value).

- [ ] **Step 2: Expose `starredProjectGroups`**

For every place that currently exposes `projectGroups` from the sidebar payload, also expose `starredProjectGroups`. Default to empty array if absent (defensive — server should always emit it post-Task 4):

```ts
const projectGroups = sidebar?.projectGroups ?? []
const starredProjectGroups = sidebar?.starredProjectGroups ?? []
```

If the hook returns a single object, add `starredProjectGroups` to that object too.

- [ ] **Step 3: Typecheck**

Run: `bun run check 2>&1 | head -30`
Expected: no errors.

- [ ] **Step 4: Run useKannaState tests**

Run: `bun test src/client/app/useKannaState.test.ts 2>&1 | tail -10`
Expected: all pass (no test changes needed — pass-through wiring).

- [ ] **Step 5: Commit**

```bash
git add src/client/app/useKannaState.ts
git commit -m "feat(client): expose starredProjectGroups from useKannaState"
```

---

## Task 6: Context menu — star/unstar entry

**Files:**
- Modify: `src/client/components/chat-ui/sidebar/Menus.tsx`
- Create: `src/client/components/chat-ui/sidebar/Menus.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/client/components/chat-ui/sidebar/Menus.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { test, expect, mock } from "bun:test"
import { ProjectSectionMenu } from "./Menus"

function renderMenu(props: Partial<Parameters<typeof ProjectSectionMenu>[0]> = {}) {
  const onToggleStar = mock(() => {})
  render(
    <ProjectSectionMenu
      editorLabel="VS Code"
      starred={false}
      onCopyPath={() => {}}
      onShowArchived={() => {}}
      onOpenInFinder={() => {}}
      onOpenInEditor={() => {}}
      onToggleStar={onToggleStar}
      onHide={() => {}}
      {...props}
    >
      <button data-testid="trigger">trigger</button>
    </ProjectSectionMenu>
  )
  // open the context menu
  fireEvent.contextMenu(screen.getByTestId("trigger"))
  return { onToggleStar }
}

test("shows 'Star project' when not starred", () => {
  renderMenu({ starred: false })
  expect(screen.getByText("Star project")).toBeTruthy()
})

test("shows 'Unstar project' when starred", () => {
  renderMenu({ starred: true })
  expect(screen.getByText("Unstar project")).toBeTruthy()
})

test("clicking entry calls onToggleStar once", () => {
  const { onToggleStar } = renderMenu({ starred: false })
  fireEvent.click(screen.getByText("Star project"))
  expect(onToggleStar.mock.calls.length).toBe(1)
})
```

If the test setup pattern in this codebase uses a different test renderer or context-menu open trigger, copy the pattern from `Menus.stack.test.tsx`.

- [ ] **Step 2: Run — verify fail**

Run: `bun test src/client/components/chat-ui/sidebar/Menus.test.tsx 2>&1 | tail -15`
Expected: failures — `starred` / `onToggleStar` props not accepted.

- [ ] **Step 3: Extend `ProjectSectionMenu`**

Edit `src/client/components/chat-ui/sidebar/Menus.tsx`:

```tsx
import type { ReactNode } from "react"
import { Archive, Code, Copy, EyeOff, FolderOpen, Pencil, Split, Star, StarOff, Trash2, UserRoundPlus, Users } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui/context-menu"

export function ProjectSectionMenu({
  editorLabel,
  starred,
  onCopyPath,
  onShowArchived,
  onOpenInFinder,
  onOpenInEditor,
  onToggleStar,
  onHide,
  children,
}: {
  editorLabel: string
  starred: boolean
  onCopyPath: () => void
  onShowArchived: () => void
  onOpenInFinder: () => void
  onOpenInEditor: () => void
  onToggleStar: () => void
  onHide: () => void
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onToggleStar()
          }}
        >
          {starred ? <StarOff className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
          <span className="text-xs font-medium">{starred ? "Unstar project" : "Star project"}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onCopyPath()
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Copy Path</span>
        </ContextMenuItem>
        {/* ...existing entries unchanged: Show Archived, Show in Finder, Open in editor, Hide... */}
      </ContextMenuContent>
    </ContextMenu>
  )
}
```

Keep the existing menu items (Show Archived, Show in Finder, Open in editor, Hide) below the new Star entry — only the props signature and the new entry change.

- [ ] **Step 4: Run — verify pass**

Run: `bun test src/client/components/chat-ui/sidebar/Menus.test.tsx 2>&1 | tail -10`
Expected: 3 new tests pass.

- [ ] **Step 5: Update call sites**

Compile errors will now flag any caller of `ProjectSectionMenu` missing `starred` / `onToggleStar`. Find them:

```bash
git grep -n "ProjectSectionMenu" src/client
```

Expected callers: `LocalProjectsSection.tsx`. Pass `starred={Boolean(group.starredAt)}` and `onToggleStar={() => onToggleStar?.(group.groupKey, !group.starredAt)}` — wire the prop through the component chain (see Task 7).

For now, add a temporary `starred={false} onToggleStar={() => {}}` if Task 7 isn't done yet — but the cleaner path is to do Task 7 immediately and commit together.

- [ ] **Step 6: Commit**

(Combined commit with Task 7 if doing both in one pass.)

---

## Task 7: Sidebar — render Starred section + wire star command

**Files:**
- Modify: `src/client/components/chat-ui/sidebar/LocalProjectsSection.tsx`
- Modify: `src/client/components/chat-ui/sidebar/LocalProjectsSection.test.tsx`

- [ ] **Step 1: Write failing tests**

Append to `src/client/components/chat-ui/sidebar/LocalProjectsSection.test.tsx`:

```tsx
test("renders Starred section above main list when starredGroups non-empty", () => {
  const starredGroups = [makeGroup({ groupKey: "p1", localPath: "/a", starredAt: 1000 })]
  const projectGroups = [makeGroup({ groupKey: "p2", localPath: "/b" })]

  render(
    <LocalProjectsSection
      projectGroups={projectGroups}
      starredGroups={starredGroups}
      // ...other required props copied from existing test helper
    />
  )

  const headers = screen.getAllByRole("button", { name: /Starred|\/b/ })
  // Starred header must precede the project header in the DOM
  const starredHeader = screen.getByText("Starred")
  const projectHeader = screen.getByText("/b")
  expect(starredHeader.compareDocumentPosition(projectHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test("hides Starred section when starredGroups empty", () => {
  render(
    <LocalProjectsSection
      projectGroups={[makeGroup({ groupKey: "p1", localPath: "/a" })]}
      starredGroups={[]}
      // ...
    />
  )
  expect(screen.queryByText("Starred")).toBeNull()
})

test("starred groups are not wrapped in a sortable DnD context", () => {
  const starredGroups = [makeGroup({ groupKey: "p1", localPath: "/a", starredAt: 1000 })]
  const { container } = render(
    <LocalProjectsSection
      projectGroups={[]}
      starredGroups={starredGroups}
      // ...
    />
  )
  // dnd-kit sortable handles have data-sortable / aria attributes; assert none in starred section
  const starredSection = container.querySelector("[data-section='starred']")!
  expect(starredSection.querySelector("[role='listitem'][aria-roledescription='sortable']")).toBeNull()
})
```

Reuse the existing test helper in this file for `makeGroup` (or copy its inline shape). The `data-section='starred'` attribute is added in Step 3 — the test asserts it.

- [ ] **Step 2: Run — verify fail**

Run: `bun test src/client/components/chat-ui/sidebar/LocalProjectsSection.test.tsx 2>&1 | tail -20`
Expected: fail — `starredGroups` prop unknown.

- [ ] **Step 3: Add `starredGroups` and `onToggleStar` props**

Edit `src/client/components/chat-ui/sidebar/LocalProjectsSection.tsx` props interface:

```ts
interface Props {
  projectGroups: SidebarProjectGroup[]
  starredGroups: SidebarProjectGroup[]
  editorLabel: string
  collapsedSections: Set<string>
  expandedGroups: Set<string>
  onToggleSection: (key: string) => void
  onToggleExpandedGroup: (key: string) => void
  renderChatRow: (chat: SidebarChatRow) => ReactNode
  onShowArchivedProject?: (projectId: string) => void
  onNewLocalChat?: (localPath: string) => void
  onCopyPath?: (localPath: string) => void
  onOpenExternalPath?: (action: "open_finder" | "open_editor", localPath: string) => void
  onHideProject?: (projectId: string) => void
  onToggleStarProject?: (projectId: string, starred: boolean) => void
  onReorderGroups?: (newOrder: string[]) => void
  isConnected?: boolean
  startingLocalPath?: string | null
}
```

Add the same `onToggleStarProject` and `starred` plumbing to `SortableProjectGroupProps` and the row-rendering helpers. Where `ProjectSectionMenu` is rendered, pass:

```tsx
<ProjectSectionMenu
  editorLabel={editorLabel}
  starred={Boolean(group.starredAt)}
  onCopyPath={() => onCopyPath?.(localPath)}
  onShowArchived={() => onShowArchivedProject?.(group.groupKey)}
  onOpenInFinder={() => onOpenExternalPath?.("open_finder", localPath)}
  onOpenInEditor={() => onOpenExternalPath?.("open_editor", localPath)}
  onToggleStar={() => onToggleStarProject?.(group.groupKey, !group.starredAt)}
  onHide={() => onHideProject?.(group.groupKey)}
>
  {header}
</ProjectSectionMenu>
```

- [ ] **Step 4: Render the Starred section**

In the component body, render the Starred section above the main project list. Find the JSX that returns the existing `<DndContext>` block (around `:429`) and prepend a Starred section:

```tsx
{starredGroups.length > 0 && (
  <div data-section="starred" className="mb-2">
    <button
      type="button"
      onClick={() => onToggleSection("__starred__")}
      className="flex items-center gap-1.5 w-full px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
    >
      <ChevronRight
        className={cn(
          "size-3 transition-transform",
          !collapsedSections.has("__starred__") && "rotate-90"
        )}
      />
      <Star className="size-3 fill-warning text-warning" />
      <span>Starred</span>
    </button>
    {!collapsedSections.has("__starred__") && (
      <div className="flex flex-col gap-0.5">
        {starredGroups.map((group) => (
          <NonSortableProjectGroup
            key={group.groupKey}
            group={group}
            editorLabel={editorLabel}
            collapsedSections={collapsedSections}
            expandedGroups={expandedGroups}
            onToggleSection={onToggleSection}
            onToggleExpandedGroup={onToggleExpandedGroup}
            renderChatRow={renderChatRow}
            onShowArchivedProject={onShowArchivedProject}
            onNewLocalChat={onNewLocalChat}
            onCopyPath={onCopyPath}
            onOpenExternalPath={onOpenExternalPath}
            onHideProject={onHideProject}
            onToggleStarProject={onToggleStarProject}
            isConnected={isConnected}
            startingLocalPath={startingLocalPath}
          />
        ))}
      </div>
    )}
  </div>
)}
{/* existing DndContext block for projectGroups stays unchanged */}
```

Create a `NonSortableProjectGroup` helper component in the same file that renders the project header + chat list **without** the `useSortable` hook (extract the inner render from `SortableProjectGroup`, drop the `transform` / drag handle wiring). Import `Star` from `lucide-react`.

If there is no `text-warning` token in the Tailwind config, use `text-amber-500`.

- [ ] **Step 5: Wire the WS command**

The component is rendered by a parent (search `git grep -n "LocalProjectsSection" src/client`) — likely a sidebar component that already wires `onHideProject` etc. via the WS client. Add `onToggleStarProject` to the same handler block:

```ts
onToggleStarProject={(projectId, starred) => {
  wsClient.command({ type: "project.setStar", projectId, starred })
}}
```

If the WS client uses a different call shape, mirror the existing `project.remove` / `sidebar.reorderProjectGroups` invocation pattern.

Also expose `starredProjectGroups` from `useKannaState` (already done in Task 5) and pass as `starredGroups={starredProjectGroups}`.

- [ ] **Step 6: Run — verify pass**

Run: `bun test src/client/components/chat-ui/sidebar/LocalProjectsSection.test.tsx 2>&1 | tail -10`
Expected: all new tests pass.

- [ ] **Step 7: Full suite**

Run: `bun test 2>&1 | tail -5`
Expected: all 1311+ tests pass.

- [ ] **Step 8: Typecheck + build**

Run: `bun run check 2>&1 | tail -10`
Expected: typecheck passes, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/client
git commit -m "feat(sidebar): render Starred section above project list with context menu toggle"
```

---

## Task 8: Manual verification + impeccable polish

**Files:** (no code changes unless polish is needed)

- [ ] **Step 1: Run the dev server**

Run: `bun run dev` (in foreground; ctrl-c when done)

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5174`. Verify in order:

1. Open the sidebar. Right-click an existing project header. **Star project** appears as the first entry with a `Star` icon.
2. Click **Star project**. Project disappears from the main list and appears in a new **Starred** section at the top of the sidebar. The starred section header shows a filled amber star and the word "Starred".
3. Right-click the now-starred project. Entry reads **Unstar project** with a `StarOff` icon.
4. Star a second project. New star appears at the top of the Starred section (newest-first ordering).
5. Click the Starred section header. Section collapses; click again — expands.
6. Unstar both projects. Starred section disappears entirely.
7. Reload the page. Starred state persists across reload (if any project is currently starred).

- [ ] **Step 3: Invoke impeccable for visual review**

Once functional, invoke the `impeccable` skill on the Starred section header treatment. Specifically ask it to assess:
- Is the amber star tone too loud / too quiet against the muted section header text?
- Is there enough visual separation between the Starred section and the main project list (margin, divider)?
- Does the star icon size (12px) read at typical sidebar widths?

Apply whatever inline tweaks impeccable recommends. Keep changes purely visual — no behaviour change.

- [ ] **Step 4: Commit any polish changes**

```bash
git add src/client/components/chat-ui/sidebar
git commit -m "polish(sidebar): tune Starred section visual hierarchy"
```

(Skip this commit if impeccable suggested no changes.)

---

## Task 9: Final verification

- [ ] **Step 1: Full test suite**

Run: `bun test 2>&1 | tail -5`
Expected: all pass (1311 baseline + new tests).

- [ ] **Step 2: Typecheck + production build**

Run: `bun run check 2>&1 | tail -5`
Expected: clean build.

- [ ] **Step 3: Verify branch is ahead of main with clean commits**

Run: `git log --oneline main..HEAD`
Expected: one commit per task (8 commits roughly: spec + 7-8 implementation commits).

- [ ] **Step 4: Push branch**

Run: `git push -u origin feat/star-projects`

- [ ] **Step 5: Open PR**

Use `gh pr create --repo cuongtranba/kanna --base main --head feat/star-projects` per project CLAUDE.md. Title: `feat: star projects`. Body should reference the spec and summarise user-facing behaviour.
