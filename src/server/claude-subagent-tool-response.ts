/**
 * Standalone functions for managing subagent pending tool-response resolvers.
 *
 * Extracted from AgentCoordinator to keep agent.ts below the 600-LOC target.
 * No direct IO — all side-effects are injected via SubagentToolResponseDeps.
 */

import type { AnyValue } from "../shared/errors"
import type { SubagentRunEvent } from "./events"

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/** Minimal surface of SubagentOrchestrator required by this module. */
export interface SubagentToolResponseOrchestratorDeps {
  notifySubagentToolResolved(runId: string): void
  cancelRun(chatId: string, runId: string): void
}

/** Minimal surface of EventStore required by this module. */
export interface SubagentToolResponseStoreDeps {
  appendSubagentEvent(event: SubagentRunEvent): Promise<void>
}

/** Dependency bag injected into every function in this module. */
export interface SubagentToolResponseDeps {
  /** The shared in-memory resolver map owned by AgentCoordinator. */
  subagentPendingResolvers: Map<
    string,
    { resolve: (v: AnyValue) => void; reject: (e: Error) => void }
  >
  store: SubagentToolResponseStoreDeps
  subagentOrchestrator: SubagentToolResponseOrchestratorDeps
  emitStateChange: (chatId: string) => void
}

// ---------------------------------------------------------------------------
// Command shape re-exports (inline to avoid protocol import cycle)
// ---------------------------------------------------------------------------

export type RespondSubagentToolCommand = {
  type: "chat.respondSubagentTool"
  chatId: string
  runId: string
  toolUseId: string
  result: Record<string, unknown>
}

export type CancelSubagentRunCommand = {
  type: "chat.cancelSubagentRun"
  chatId: string
  runId: string
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Builds the map key used to look up a pending subagent tool resolver. */
export function subagentPendingKey(
  chatId: string,
  runId: string,
  toolUseId: string,
): string {
  return `${chatId}::${runId}::${toolUseId}`
}

// ---------------------------------------------------------------------------
// Resolver management
// ---------------------------------------------------------------------------

/**
 * Rejects all pending resolvers whose key satisfies `predicate`.
 * Mutates `deps.subagentPendingResolvers` in place.
 */
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

/** Rejects all pending resolvers that belong to `chatId`. */
export function rejectPendingResolversForChat(
  deps: Pick<SubagentToolResponseDeps, "subagentPendingResolvers">,
  chatId: string,
): void {
  const prefix = `${chatId}::`
  rejectPendingResolvers(deps, (k) => k.startsWith(prefix), "chat cancelled")
}

/** Rejects all pending resolvers that belong to a specific run within `chatId`. */
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

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * Handles a `chat.respondSubagentTool` command from the client.
 *
 * Resolves the pending resolver for the given tool-use, persists a
 * `subagent_tool_resolved` event, notifies the orchestrator, and emits a
 * state-change.
 *
 * Idempotent: a double-submit (client retry, concurrent WS messages, or a
 * response arriving after the run already terminated) is silently ignored.
 */
export async function respondSubagentTool(
  deps: SubagentToolResponseDeps,
  command: RespondSubagentToolCommand,
): Promise<void> {
  const key = subagentPendingKey(command.chatId, command.runId, command.toolUseId)
  const resolver = deps.subagentPendingResolvers.get(key)
  if (!resolver) {
    // Idempotent: a double-submit (client retry, concurrent WS messages, or
    // a response arriving after the run already terminated) should not
    // surface a confusing error to the UI. Resolver-absent = already
    // resolved or run died; nothing to do.
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

/**
 * Handles a `chat.cancelSubagentRun` command from the client.
 *
 * Cancels the named run via the orchestrator.
 */
export function cancelSubagentRun(
  deps: Pick<SubagentToolResponseDeps, "subagentOrchestrator">,
  command: CancelSubagentRunCommand,
): void {
  deps.subagentOrchestrator.cancelRun(command.chatId, command.runId)
}
