import { chatNotFound, projectNotFound, StaleStateError } from "../shared/errors"

interface Tombstoned {
  deletedAt?: number
}

export function liveRecord<T extends Tombstoned>(records: ReadonlyMap<string, T>, id: string): T | null {
  const record = records.get(id)
  return record && !record.deletedAt ? record : null
}

function requireLive<T extends Tombstoned>(
  records: ReadonlyMap<string, T>,
  id: string,
  fail: () => Error,
): T {
  const record = liveRecord(records, id)
  if (!record) throw fail()
  return record
}

export function requireLiveChat<T extends Tombstoned>(chats: ReadonlyMap<string, T>, chatId: string): T {
  return requireLive(chats, chatId, chatNotFound)
}

export function requireLiveProject<T extends Tombstoned>(
  projects: ReadonlyMap<string, T>,
  projectId: string,
  options?: { namedInError: boolean },
): T {
  return requireLive(
    projects,
    projectId,
    options?.namedInError ? () => new StaleStateError(`Project not found: ${projectId}`) : projectNotFound,
  )
}

export function requireLiveStack<T extends Tombstoned>(stacks: ReadonlyMap<string, T>, stackId: string): T {
  return requireLive(stacks, stackId, () => new Error("Stack not found"))
}
