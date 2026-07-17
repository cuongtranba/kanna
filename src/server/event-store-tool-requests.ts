/**
 * Tool-request read-model and write-path layers extracted from event-store.ts.
 *
 * All read functions are pure folds over the in-memory `toolRequestsById` map.
 * Write functions (putToolRequest, resolveToolRequest) accept a ToolRequestWriteDeps
 * so they can append to the event log without importing disk IO directly.
 */
import type { ToolRequest, ToolRequestDecision, ToolRequestStatus } from "../shared/permission-policy"
import type { StoreEvent, ToolRequestEvent } from "./events"
import {
  buildPutToolRequestEvent,
  buildResolveToolRequestEvent,
} from "./event-store-write-ops"

// ─── Write-path deps ──────────────────────────────────────────────────────

export interface ToolRequestWriteDeps {
  readonly toolRequestsById: Map<string, ToolRequest>
  readonly toolRequestsLogPath: string
  append: (filePath: string, event: StoreEvent) => Promise<void>
}

/**
 * Apply a single `ToolRequestEvent` to the in-memory `toolRequestsById` map
 * (mutates in place).
 *
 * Mirrors the two `case "tool_request_*"` branches that previously lived
 * inside `EventStore.applyEvent`.
 */
export function applyToolRequestEvent(
  toolRequestsById: Map<string, ToolRequest>,
  event: ToolRequestEvent,
): void {
  switch (event.type) {
    case "tool_request_put": {
      toolRequestsById.set(event.request.id, { ...event.request })
      break
    }
    case "tool_request_resolved": {
      const existing = toolRequestsById.get(event.id)
      if (!existing) break
      toolRequestsById.set(event.id, {
        ...existing,
        status: event.status,
        decision: event.decision ?? existing.decision,
        resolvedAt: event.resolvedAt,
        mismatchReason: event.mismatchReason,
      })
      break
    }
  }
}

/**
 * Return a defensive copy of the tool request with the given id, or `null`
 * if not found.
 */
export function getToolRequest(
  toolRequestsById: Map<string, ToolRequest>,
  id: string,
): ToolRequest | null {
  const req = toolRequestsById.get(id)
  return req ? { ...req } : null
}

/**
 * Return defensive copies of all pending tool requests for the given chat.
 */
export function listPendingToolRequests(
  toolRequestsById: Map<string, ToolRequest>,
  chatId: string,
): ToolRequest[] {
  const out: ToolRequest[] = []
  for (const req of toolRequestsById.values()) {
    if (req.chatId !== chatId) continue
    if (req.status !== "pending") continue
    out.push({ ...req })
  }
  return out
}

/**
 * Return defensive copies of every tool request in the map.
 */
export function scanAllToolRequests(
  toolRequestsById: Map<string, ToolRequest>,
): ToolRequest[] {
  return [...toolRequestsById.values()].map((req) => ({ ...req }))
}

/**
 * Remove every tool request belonging to the given chat from the map
 * (mutates in place).  Called when a chat is deleted.
 */
export function deleteToolRequestsForChat(
  toolRequestsById: Map<string, ToolRequest>,
  chatId: string,
): void {
  for (const [id, req] of toolRequestsById) {
    if (req.chatId === chatId) {
      toolRequestsById.delete(id)
    }
  }
}

// ─── Write-path functions ──────────────────────────────────────────────────

/** Persist + apply a new tool request. */
export async function putToolRequest(
  deps: ToolRequestWriteDeps,
  req: ToolRequest,
): Promise<void> {
  const event = buildPutToolRequestEvent(req)
  applyToolRequestEvent(deps.toolRequestsById, event)
  await deps.append(deps.toolRequestsLogPath, event)
}

/** Persist + apply a tool request resolution. */
export async function resolveToolRequest(
  deps: ToolRequestWriteDeps,
  id: string,
  args: { status: ToolRequestStatus; decision?: ToolRequestDecision; resolvedAt: number; mismatchReason?: string },
): Promise<void> {
  const event = buildResolveToolRequestEvent(deps.toolRequestsById, id, args)
  applyToolRequestEvent(deps.toolRequestsById, event)
  await deps.append(deps.toolRequestsLogPath, event)
}

// Re-export types consumed by event-store.ts method signatures so callers
// can import them from one place.
export type { ToolRequest, ToolRequestDecision, ToolRequestStatus }
