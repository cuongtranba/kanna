import { createStateStore, type StateStore } from "@json-render/react"
import type { JsonObject } from "../../../shared/json"

const MAX_VIEWS = 64

const stores = new Map<string, StateStore>()

export function viewStateStore(viewKey: string, initialState: JsonObject): StateStore {
  const existing = stores.get(viewKey)
  if (existing) {
    stores.delete(viewKey)
    stores.set(viewKey, existing)
    return existing
  }
  const created = createStateStore({ ...initialState })
  stores.set(viewKey, created)
  while (stores.size > MAX_VIEWS) {
    const oldest = stores.keys().next().value
    if (oldest === undefined) break
    stores.delete(oldest)
  }
  return created
}
