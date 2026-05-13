# Star Projects — Design

**Status:** Approved, ready for implementation plan
**Author:** Brainstorm session 2026-05-13
**Branch:** `feat/star-projects`

## Problem

Kanna's sidebar groups chats under projects. Users with many projects must scroll or rely on drag-reorder to keep important projects visible. There is no first-class way to flag a project as "important" and pin it to the top.

## Goal

Let users star a project so it appears in a dedicated **Starred** section at the top of the sidebar, ordered by most recently starred.

## Non-Goals

- Starring individual chats (only projects in v1)
- Manual drag-reorder within the Starred section (order is derived from `starredAt`)
- Keyboard shortcut to toggle star
- Syncing starred state across machines (state is local, same as all other Kanna state)

## User Experience

1. User right-clicks a project header in the sidebar → context menu shows **Star project** (with a `Star` icon).
2. Click the entry. The project animates out of the main project list and appears at the top of a new **Starred** section above all other projects.
3. Right-clicking a starred project shows **Unstar project** (with a `StarOff` icon). Click → project returns to its previous position in the main list.
4. Most recently starred project appears first within the Starred section. Order updates automatically as the user stars new projects.
5. When no project is starred, the Starred section is hidden entirely (no empty placeholder).

### Visual treatment

- **Starred section header:** Same typography as existing project section headers, prefixed with a small filled `Star` glyph (12px) in a subtle warning/amber tone (`text-warning` or equivalent token). Collapsible like other sections; its collapsed state persists per session via the existing `collapsedSections` set.
- **Starred project rows:** Identical to normal project rows. No trailing star glyph (the section header already communicates the state; adding a second indicator on every row is redundant).
- **Context menu entry:** `Star`/`StarOff` icon from `lucide-react`. Placed above the existing `Hide project` entry in `ProjectSectionMenu`.
- **No custom motion:** Default React re-render handles the transition. Avoid bespoke animation — it would feel gimmicky on a fast operation.

The `impeccable` skill will be invoked once during implementation to review the final header treatment and confirm the visual hierarchy reads correctly.

## Architecture

### Data model

Add an optional timestamp field to `ProjectRecord` (mirrors the `archivedAt`/`deletedAt` pattern already used on `ChatRecord`):

```ts
// src/server/events.ts
export interface ProjectRecord extends ProjectSummary {
  deletedAt?: number
  starredAt?: number  // ms epoch when starred; absent = not starred
}
```

Add the same field to the sidebar payload so the client can branch on starred status without re-looking up the project record:

```ts
// src/shared/types.ts
export interface SidebarProjectGroup {
  // ...existing fields
  starredAt?: number
}
```

Extend `SidebarData` to expose two ordered lists:

```ts
export interface SidebarData {
  starredProjectGroups: SidebarProjectGroup[]  // sorted desc by starredAt
  projectGroups: SidebarProjectGroup[]          // existing list; excludes starred
  stacks: StackSummary[]
}
```

### Events

One new `ProjectEvent` variant:

```ts
{
  v: 3
  type: "project_star_set"
  timestamp: number
  projectId: string
  starredAt: number | null  // null = unstar
}
```

Reducer in `event-store.ts`:

- On `project_star_set` with `starredAt: number` → set `projectsById[projectId].starredAt = starredAt`.
- On `project_star_set` with `starredAt: null` → delete the field (omit, not set to undefined, so JSON round-trips don't carry the key).
- Add the new type to the validated event-type lists at `event-store.ts:87-89` and the snapshot replay paths.
- Snapshot persistence: `ProjectRecord` is serialised whole, so `starredAt` round-trips with no extra code.

### WS command

New command handler in `ws-router.ts`:

- **Name:** `project.setStar`
- **Payload:** `{ projectId: string, starred: boolean }`
- **Handler:**
  1. Validate `projectId` exists in `projectsById` (reject with error if not).
  2. Append `project_star_set` event with `starredAt: starred ? Date.now() : null`.
  3. Broadcast the updated sidebar via the existing project-event broadcast path.

### Read model

In `read-models.ts`, when building `SidebarData`:

1. Iterate all non-deleted projects.
2. Partition: project goes into `starredProjectGroups` if `starredAt != null`, otherwise into `projectGroups`.
3. Sort `starredProjectGroups` by `starredAt` **descending**, with project id as a deterministic tiebreaker.
4. `projectGroups` continues to respect `sidebarProjectOrder` (starred projects filtered out — they appear in the starred section instead).

### Client

**State hook** (`src/client/app/useKannaState.ts`): expose `starredProjectGroups` from the sidebar payload alongside the existing `projectGroups`.

**Sidebar render** (`src/client/components/chat-ui/sidebar/LocalProjectsSection.tsx`):

- Accept a new prop `starredGroups: SidebarProjectGroup[]`.
- If `starredGroups.length > 0`: render a Starred section above the existing list. Section uses the same `SortableProjectGroup` row renderer but **without** the `DndContext`/`SortableContext` wrappers (no drag-reorder in this section — order is server-derived).
- Section collapsed state lives in the existing `collapsedSections` set under key `"__starred__"` (or similar reserved key — pick during implementation).
- Existing project list rendering is unchanged.

**Context menu** (`src/client/components/chat-ui/sidebar/Menus.tsx`):

- Extend `ProjectSectionMenu` to accept `starred: boolean` and `onToggleStar: () => void`.
- Render a new menu item above `Hide project`:
  - When `starred === false`: label `"Star project"`, icon `Star` from `lucide-react`.
  - When `starred === true`: label `"Unstar project"`, icon `StarOff` from `lucide-react`.

## Testing

Follow the existing TDD pattern (co-located `.test.ts(x)` per `kanna-react-style`).

### Server

- **`event-store.test.ts`:**
  - Apply `project_star_set` with timestamp → `ProjectRecord.starredAt` set to that value.
  - Apply `project_star_set` with `starredAt: null` → `starredAt` field cleared (omitted from record).
  - Replay/snapshot round-trip preserves `starredAt` across reload.
- **`read-models.test.ts`:**
  - Sidebar partitions: starred projects appear only in `starredProjectGroups`, never in `projectGroups`.
  - `starredProjectGroups` sorted desc by `starredAt`; ties broken by project id ascending (deterministic).
  - Unstarring a project: it disappears from `starredProjectGroups` and reappears in `projectGroups` at its `sidebarProjectOrder` position.
- **`ws-router.test.ts`:**
  - `project.setStar` with `starred: true` appends `project_star_set` event with `starredAt: Date.now()`.
  - `project.setStar` with `starred: false` appends event with `starredAt: null`.
  - Unknown `projectId` → command rejected, no event appended.
  - Sidebar rebroadcast fires after successful star/unstar.

### Client

- **`Menus.test.tsx` (new file or extend `Menus.stack.test.tsx`):**
  - Renders `"Star project"` entry when `starred === false`.
  - Renders `"Unstar project"` entry when `starred === true`.
  - Clicking the entry calls `onToggleStar` exactly once.
- **`LocalProjectsSection.test.tsx`:**
  - Starred section renders above main list when `starredGroups` is non-empty.
  - Starred section is hidden when `starredGroups` is empty.
  - Starred groups are not wrapped in a `DndContext` (no drag handles, no sortable behaviour).
  - Collapsed state for the Starred section persists in `collapsedSections`.

## Migration

`starredAt` is optional. Existing snapshots and event logs load unchanged. No data migration required.

## Risks & Open Questions

- **Risk:** A user could end up with many starred projects and the Starred section dominates the sidebar. Mitigation: section is collapsible. If this becomes a real problem, a soft cap or paging can be added later.
- **Risk:** `Date.now()` ties when two stars happen in the same millisecond. Mitigation: deterministic tiebreaker by project id in the read model sort.
- **Open:** Should the Starred section default to expanded or collapsed on first appearance? **Decision for implementation:** default expanded. Empty state hides the section entirely, so the first time a user sees it they have just starred something and would expect to see it.

## Out of Scope (parking lot)

- Starring individual chats
- Manual reorder within Starred section
- Bulk star/unstar
- Keyboard shortcut
- Sync across machines
