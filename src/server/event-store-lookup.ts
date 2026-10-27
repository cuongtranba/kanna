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
  kind: string,
  detail: string | undefined,
): T {
  const record = liveRecord(records, id)
  if (!record) throw new Error(detail === undefined ? `${kind} not found` : `${kind} not found: ${detail}`)
  return record
}

export function requireLiveChat<T extends Tombstoned>(chats: ReadonlyMap<string, T>, chatId: string): T {
  return requireLive(chats, chatId, "Chat", undefined)
}

export function requireLiveProject<T extends Tombstoned>(
  projects: ReadonlyMap<string, T>,
  projectId: string,
  options?: { namedInError: boolean },
): T {
  return requireLive(projects, projectId, "Project", options?.namedInError ? projectId : undefined)
}

export function requireLiveStack<T extends Tombstoned>(stacks: ReadonlyMap<string, T>, stackId: string): T {
  return requireLive(stacks, stackId, "Stack", undefined)
}
