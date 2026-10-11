import type { ServerEnvelope } from "../../shared/protocol"
import { fail, ok, type ToolResult } from "../kanna-mcp-tool"

export function envelopeToToolResult(envelope: ServerEnvelope): ToolResult {
  if (envelope.type === "error") return fail(envelope.message)
  if (envelope.type === "ack") return ok(JSON.stringify(envelope.result ?? { ok: true }))
  if (envelope.type === "snapshot") return ok(JSON.stringify(envelope.snapshot))
  return ok(JSON.stringify(envelope.event))
}
