import { randomUUID } from "node:crypto"
import { CLIENT_INFO_META_KEY, type AuthInfo, type McpServer, type ServerContext, type ToolAnnotations } from "@modelcontextprotocol/server"
import type { z } from "zod"
import { remoteMcpVia, type RemoteMcpOrigin } from "../../shared/command-origin"
import { isJsonObject, safeJsonParse, type JsonValue } from "../../shared/json"
import { log } from "../../shared/log"
import { toJsonValue } from "../json-boundary"
import type { ToolResult } from "../kanna-mcp-tool"
import { addCounter, REMOTE_MCP_TOOL_CALL } from "../observability"
import {
  auditArgs,
  auditOutcome,
  auditSubjects,
  type RemoteMcpAuditRecord,
  type RemoteMcpAuditSink,
} from "./remote-mcp-audit"
import { runInRemoteMcpCall } from "./remote-mcp-call-scope"

const MAX_RESULT_CHARS_PARSED = 200_000
const UNKNOWN_CLIENT_ID = "unknown"

export interface ToolConfig<Shape extends z.ZodObject> {
  title?: string
  description?: string
  inputSchema: Shape
  annotations?: ToolAnnotations
}

export type ToolHandler<Shape extends z.ZodObject> = (
  args: z.infer<Shape>,
  ctx: ServerContext,
) => ToolResult | Promise<ToolResult>

export interface ToolRegistrar {
  registerTool<Shape extends z.ZodObject>(name: string, config: ToolConfig<Shape>, handler: ToolHandler<Shape>): void
}

export interface ToolRegistrarSettings {
  era: "legacy" | "modern"
  authInfo?: AuthInfo
  audit: RemoteMcpAuditSink
  now?: () => number
  newCallId?: () => string
}

function clientNameOf(envelope: object | undefined): string | undefined {
  if (!envelope) return undefined
  const entry = Object.entries(envelope).find(([key]) => key === CLIENT_INFO_META_KEY)
  const info = entry ? toJsonValue(entry[1]) : null
  const name = info !== null && isJsonObject(info) ? info.name : undefined
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : undefined
}

function resultJson(result: ToolResult): JsonValue | null {
  const text = result.content[0]?.text
  return text !== undefined && text.length <= MAX_RESULT_CHARS_PARSED ? safeJsonParse(text) : null
}

function failureText(result: ToolResult): string {
  return result.content[0]?.text.slice(0, 300) ?? ""
}

export function createToolRegistrar(server: McpServer, settings: ToolRegistrarSettings): ToolRegistrar {
  const now = settings.now ?? Date.now
  const newCallId = settings.newCallId ?? randomUUID

  function originOf(tool: string, ctx: ServerContext): RemoteMcpOrigin {
    const clientId = ctx.http?.authInfo?.clientId ?? settings.authInfo?.clientId ?? UNKNOWN_CLIENT_ID
    const clientName = clientNameOf(ctx.mcpReq.envelope)
    return {
      kind: "remote_mcp",
      clientId,
      ...(clientName ? { clientName } : {}),
      via: remoteMcpVia(clientId),
      tool,
      callId: newCallId(),
    }
  }

  function audit(origin: RemoteMcpOrigin, started: number, args: JsonValue, outcome: Pick<RemoteMcpAuditRecord, "outcome" | "error">, result: JsonValue | null) {
    const entry: RemoteMcpAuditRecord = {
      at: new Date(started).toISOString(),
      callId: origin.callId,
      tool: origin.tool,
      clientId: origin.clientId,
      ...(origin.clientName ? { clientName: origin.clientName } : {}),
      via: origin.via,
      era: settings.era,
      durationMs: now() - started,
      ...outcome,
      ...auditSubjects(args, result),
      args: auditArgs(args),
    }
    settings.audit.record(entry)
    addCounter(REMOTE_MCP_TOOL_CALL, 1, { tool: origin.tool, outcome: outcome.outcome, via: origin.via })
    log.info("[remote-mcp] tool call", {
      tool: origin.tool,
      callId: origin.callId,
      clientId: origin.clientId,
      outcome: outcome.outcome,
      durationMs: entry.durationMs,
      chatId: entry.chatId,
    })
  }

  return {
    registerTool<Shape extends z.ZodObject>(name: string, config: ToolConfig<Shape>, handler: ToolHandler<Shape>) {
      const schema: z.ZodObject = config.inputSchema
      server.registerTool(name, { ...config, inputSchema: schema }, async (rawArgs, ctx) => {
        const args = config.inputSchema.parse(rawArgs)
        const origin = originOf(name, ctx)
        const started = now()
        const loggedArgs = toJsonValue(args)
        try {
          const result = await runInRemoteMcpCall(origin, () => handler(args, ctx))
          const parsed = resultJson(result)
          const failed = result.isError === true
          audit(
            origin,
            started,
            loggedArgs,
            { outcome: auditOutcome(failed, parsed), ...(failed ? { error: failureText(result) } : {}) },
            parsed,
          )
          return result
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          audit(origin, started, loggedArgs, { outcome: "error", error: message.slice(0, 300) }, null)
          throw error
        }
      })
    },
  }
}
