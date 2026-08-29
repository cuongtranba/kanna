/**
 * Project and stack CRUD write-path extracted from event-store.ts.
 *
 * Functions take the minimum state they need as individual parameters so no
 * new *Deps bundle is required.
 */
import type { ProjectRecord, StackRecord, StoreEvent } from "./events"
import {
  buildAddProjectToStackEvent,
  buildCreateStackEvent,
  buildOpenProjectResult,
  buildRemoveProjectEvent,
  buildRemoveProjectFromStackEvent,
  buildRemoveStackEvent,
  buildRenameStackEvent,
  buildSetProjectStarEvent,
} from "./event-store-write-ops"

type Commit = (event: StoreEvent) => Promise<void>

// ─── Project CRUD ─────────────────────────────────────────────────────────

export async function openProject(
  projectsById: Map<string, ProjectRecord>,
  projectIdsByPath: Map<string, string>,
  commit: Commit,
  localPath: string,
  title?: string,
) {
  const result = buildOpenProjectResult({ projectsById, projectIdsByPath }, localPath, title)
  if (result.kind === "existing") return result.project
  await commit(result.event)
  return projectsById.get(result.event.projectId)!
}

export async function removeProject(projectsById: Map<string, ProjectRecord>, commit: Commit, projectId: string) {
  await commit(buildRemoveProjectEvent(projectsById, projectId))
}

export async function setProjectStar(projectsById: Map<string, ProjectRecord>, commit: Commit, projectId: string, starred: boolean) {
  await commit(buildSetProjectStarEvent(projectsById, projectId, starred))
}

// ─── Stack CRUD ───────────────────────────────────────────────────────────

export async function createStack(
  projectsById: Map<string, ProjectRecord>,
  stacksById: Map<string, StackRecord>,
  commit: Commit,
  title: string,
  projectIds: string[],
): Promise<StackRecord> {
  const event = buildCreateStackEvent({ projectsById, stacksById }, title, projectIds)
  await commit(event)
  return stacksById.get(event.stackId)!
}

export function getStack(stacksById: Map<string, StackRecord>, stackId: string): StackRecord | null {
  const s = stacksById.get(stackId)
  return s && !s.deletedAt ? s : null
}

export function listStacks(stacksById: Map<string, StackRecord>): StackRecord[] {
  return [...stacksById.values()].filter((s) => !s.deletedAt)
}

export async function renameStack(stacksById: Map<string, StackRecord>, commit: Commit, stackId: string, title: string): Promise<void> {
  const event = buildRenameStackEvent(stacksById, stackId, title)
  if (event) await commit(event)
}

export async function removeStack(stacksById: Map<string, StackRecord>, commit: Commit, stackId: string): Promise<void> {
  const event = buildRemoveStackEvent(stacksById, stackId)
  if (event) await commit(event)
}

export async function addProjectToStack(
  projectsById: Map<string, ProjectRecord>,
  stacksById: Map<string, StackRecord>,
  commit: Commit,
  stackId: string,
  projectId: string,
): Promise<void> {
  const event = buildAddProjectToStackEvent({ projectsById, stacksById }, stackId, projectId)
  if (event) await commit(event)
}

export async function removeProjectFromStack(stacksById: Map<string, StackRecord>, commit: Commit, stackId: string, projectId: string): Promise<void> {
  const event = buildRemoveProjectFromStackEvent(stacksById, stackId, projectId)
  if (event) await commit(event)
}
