import { EventStore } from "../event-store"
import { InMemoryStorageBackend } from "./in-memory-storage"

const sharedBackends = new Map<string, InMemoryStorageBackend>()

export function createTestEventStore(dataDir: string = "/virtual-test-data"): EventStore {
  let backend = sharedBackends.get(dataDir)
  if (!backend) {
    backend = new InMemoryStorageBackend()
    sharedBackends.set(dataDir, backend)
  }
  return new EventStore(dataDir, backend)
}

export function resetTestEventStorage(): void {
  sharedBackends.clear()
}
