
import type { AutoContinueEvent } from "./auto-continue/events"
import { deriveLoopState } from "./auto-continue/read-model"
import { confinePathToDir } from "./input-validation"
import type { LoopTrackingRegistry } from "./loop-tracking-registry"

export interface LoopTrackingSyncDeps {
  getAutoContinueEvents: (chatId: string) => readonly AutoContinueEvent[]
  registry: Pick<LoopTrackingRegistry, "register" | "unregister">
}

export function syncLoopTracking(deps: LoopTrackingSyncDeps, chatId: string): void {
  const loop = deriveLoopState(deps.getAutoContinueEvents(chatId), chatId)
  if (!loop?.workdirAbs || !loop.trackingFileRel) {
    deps.registry.unregister(chatId)
    return
  }
  const confined = confinePathToDir(loop.trackingFileRel, loop.workdirAbs, "tracking file")
  if ("error" in confined) {
    deps.registry.unregister(chatId)
    return
  }
  deps.registry.register(chatId, confined.abs)
}

export function rehydrateLoopTracking(
  deps: LoopTrackingSyncDeps,
  chatIds: readonly string[],
): void {
  for (const chatId of chatIds) syncLoopTracking(deps, chatId)
}
