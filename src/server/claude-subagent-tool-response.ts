
import type { JsonObject, JsonValue } from "../shared/json"
import type { SubagentRunEvent } from "./events"


export interface SubagentToolResponseOrchestratorDeps {
  notifySubagentToolResolved(runId: string): void
  cancelRun(chatId: string, runId: string): void
}

export interface SubagentToolResponseStoreDeps {
  appendSubagentEvent(event: SubagentRunEvent): Promise<void>
}

export interface SubagentToolResponseDeps {
  subagentPendingResolvers: Map<
    string,
    { resolve: (v: JsonValue) => void; reject: (e: Error) => void }
  >
  store: SubagentToolResponseStoreDeps
  subagentOrchestrator: SubagentToolResponseOrchestratorDeps
  emitStateChange: (chatId: string) => void
}


export type RespondSubagentToolCommand = {
  type: "chat.respondSubagentTool"
  chatId: string
  runId: string
  toolUseId: string
  result: JsonObject
}

export type CancelSubagentRunCommand = {
  type: "chat.cancelSubagentRun"
  chatId: string
  runId: string
}


export function subagentPendingKey(
  chatId: string,
  runId: string,
  toolUseId: string,
): string {
  return `${chatId}::${runId}::${toolUseId}`
}


export function rejectPendingResolvers(
  deps: Pick<SubagentToolResponseDeps, "subagentPendingResolvers">,
  predicate: (key: string) => boolean,
  reason: string,
): void {
  for (const [key, resolver] of deps.subagentPendingResolvers) {
    if (!predicate(key)) continue
    deps.subagentPendingResolvers.delete(key)
    resolver.reject(new Error(reason))
  }
}

export function rejectPendingResolversForChat(
  deps: Pick<SubagentToolResponseDeps, "subagentPendingResolvers">,
  chatId: string,
): void {
  const prefix = `${chatId}::`
  rejectPendingResolvers(deps, (k) => k.startsWith(prefix), "chat cancelled")
}

export function rejectPendingResolversForRun(
  deps: Pick<SubagentToolResponseDeps, "subagentPendingResolvers">,
  chatId: string,
  runId: string,
): void {
  const prefix = `${chatId}::${runId}::`
  rejectPendingResolvers(
    deps,
    (k) => k.startsWith(prefix),
    "subagent run terminated",
  )
}


export async function respondSubagentTool(
  deps: SubagentToolResponseDeps,
  command: RespondSubagentToolCommand,
): Promise<void> {
  const key = subagentPendingKey(command.chatId, command.runId, command.toolUseId)
  const resolver = deps.subagentPendingResolvers.get(key)
  if (!resolver) {
    return
  }
  deps.subagentPendingResolvers.delete(key)
  await deps.store.appendSubagentEvent({
    v: 3,
    type: "subagent_tool_resolved",
    timestamp: Date.now(),
    chatId: command.chatId,
    runId: command.runId,
    toolUseId: command.toolUseId,
    result: command.result,
    resolution: "user",
  })
  deps.subagentOrchestrator.notifySubagentToolResolved(command.runId)
  resolver.resolve(command.result)
  deps.emitStateChange(command.chatId)
}

export function cancelSubagentRun(
  deps: Pick<SubagentToolResponseDeps, "subagentOrchestrator">,
  command: CancelSubagentRunCommand,
): void {
  deps.subagentOrchestrator.cancelRun(command.chatId, command.runId)
}
