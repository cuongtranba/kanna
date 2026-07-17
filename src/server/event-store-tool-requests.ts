/**
 * Tool-request read-model layer extracted from event-store.ts.
 *
 * All functions here are pure folds over the in-memory
 * `toolRequestsById` map — no IO, no class state.  The class in
 * event-store.ts calls these and remains the single owner of the map.
 */
import type { ToolRequest, ToolRequestDecision, ToolRequestStatus } from "../shared/permission-policy"
import type { ToolRequestEvent } from "./events"

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

// Re-export types consumed by event-store.ts method signatures so callers
// can import them from one place.
export type { ToolRequest, ToolRequestDecision, ToolRequestStatus }
