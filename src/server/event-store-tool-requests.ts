import type { ToolRequest, ToolRequestDecision, ToolRequestStatus } from "../shared/permission-policy"
import type { StoreEvent, ToolRequestEvent } from "./events"
import {
  buildPutToolRequestEvent,
  buildResolveToolRequestEvent,
} from "./event-store-write-ops"


export interface ToolRequestWriteDeps {
  readonly toolRequestsById: Map<string, ToolRequest>
  readonly toolRequestsLogPath: string
  append: (filePath: string, event: StoreEvent) => Promise<void>
}

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

export function getToolRequest(
  toolRequestsById: Map<string, ToolRequest>,
  id: string,
): ToolRequest | null {
  const req = toolRequestsById.get(id)
  return req ? { ...req } : null
}

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

export function scanAllToolRequests(
  toolRequestsById: Map<string, ToolRequest>,
): ToolRequest[] {
  return [...toolRequestsById.values()].map((req) => ({ ...req }))
}

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


export async function putToolRequest(
  deps: ToolRequestWriteDeps,
  req: ToolRequest,
): Promise<void> {
  const event = buildPutToolRequestEvent(req)
  applyToolRequestEvent(deps.toolRequestsById, event)
  await deps.append(deps.toolRequestsLogPath, event)
}

export async function resolveToolRequest(
  deps: ToolRequestWriteDeps,
  id: string,
  args: { status: ToolRequestStatus; decision?: ToolRequestDecision; resolvedAt: number; mismatchReason?: string },
): Promise<void> {
  const event = buildResolveToolRequestEvent(deps.toolRequestsById, id, args)
  applyToolRequestEvent(deps.toolRequestsById, event)
  await deps.append(deps.toolRequestsLogPath, event)
}

export type { ToolRequest, ToolRequestDecision, ToolRequestStatus }
