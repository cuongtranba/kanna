
import type { StructuredDoc } from "../shared/structured-doc/types"
import { LOOP_SECTIONS, type LoopTrackingSnapshot } from "../shared/loop-progress"
import { createWatchedRegistry } from "./watched-registry"

const DEFAULT_MAX_DONE_ENTRIES = 200

export interface LoopTrackingRegistryDeps {
  read: (absPath: string) => string | null
  watch: (absPath: string, onChange: () => void) => () => void
  resolveDoc: (absPath: string) => StructuredDoc | null
  maxDoneEntries?: number
}

export interface LoopTrackingRegistry {
  register(chatId: string, trackingFileAbs: string): void
  unregister(chatId: string): void
  snapshot(chatId: string): LoopTrackingSnapshot | null
  subscribe(cb: (chatId: string) => void): () => void
}

function parse(
  content: string,
  doc: StructuredDoc,
  maxDoneEntries: number,
): LoopTrackingSnapshot {
  const doneEntries = doc.listItems(content, LOOP_SECTIONS.progress)
  return {
    doneEntries: doneEntries.slice(0, maxDoneEntries),
    nextChunkSection: doc.query(content, { sections: [LOOP_SECTIONS.nextChunk] }).content.trimEnd(),
  }
}

export function createLoopTrackingRegistry(deps: LoopTrackingRegistryDeps): LoopTrackingRegistry {
  const maxDoneEntries = deps.maxDoneEntries ?? DEFAULT_MAX_DONE_ENTRIES

  const registry = createWatchedRegistry<LoopTrackingSnapshot | null>({
    watch: deps.watch,
    load: (path) => {
      const doc = deps.resolveDoc(path)
      if (!doc) return null
      const content = deps.read(path)
      return content === null ? null : parse(content, doc, maxDoneEntries)
    },
  })

  return {
    register: registry.register,
    unregister: registry.unregister,
    snapshot: (chatId) => registry.entry(chatId)?.state ?? null,
    subscribe: registry.subscribe,
  }
}
