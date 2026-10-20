import { randomUUID } from "node:crypto"
import { isInboundHandlerMode, type InboundHandler } from "../shared/inbound/handler"
import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../shared/json"
import type { AppSettingsPatch } from "../shared/app-settings-types"
import type { McpServerConfig } from "../shared/mcp-types"
import {
  clampMcpSourceInterval,
  isMcpSourceMode,
  MCP_SOURCE_INTERVAL_MIN_MS,
  type McpSource,
  type McpSourceInput,
  type McpSourcePatch,
} from "../shared/mcp-sources/types"
import { validateMcpSource } from "../shared/mcp-sources/validate"
import { isAgentProvider } from "../shared/types"

type McpSourcesPatch = NonNullable<AppSettingsPatch["mcpSources"]>

export class McpSourceValidationException extends Error {
  constructor(readonly validationError: { code: "INVALID" | "UNKNOWN_SERVER" | "NOT_FOUND"; message: string }) {
    super(validationError.message)
    this.name = "McpSourceValidationException"
  }
}

interface FlatSource {
  mode: McpSourceInput["mode"]
  name: string
  serverId: string
  enabled: boolean
  threadKeyPath: string
  senderPath: string
  handler: InboundHandler
  resourceUris: string[]
  tool: string
  args: JsonObject
  cursorArg: string
  cursorPath: string
  itemsPath: string
  itemKeyPath: string | null
  intervalMs: number
}

const EMPTY_HANDLER: InboundHandler = { mode: "notify", template: "", replyHint: "", pushEnabled: true }

function flatten(source: McpSourceInput | McpSource): FlatSource {
  const common = {
    name: source.name,
    serverId: source.serverId,
    enabled: source.enabled ?? true,
    threadKeyPath: source.threadKeyPath,
    senderPath: source.senderPath,
    handler: source.handler,
  }
  if (source.mode === "subscribe") {
    return { ...common, mode: "subscribe", resourceUris: source.resourceUris, tool: "", args: {}, cursorArg: "", cursorPath: "", itemsPath: "", itemKeyPath: null, intervalMs: MCP_SOURCE_INTERVAL_MIN_MS }
  }
  const { tool, args, cursorArg, cursorPath, itemsPath, itemKeyPath, intervalMs } = source
  return { ...common, mode: "poll", resourceUris: [], tool, args, cursorArg, cursorPath, itemsPath, itemKeyPath, intervalMs }
}

function assemble(flat: FlatSource, id: string, createdAt: number, updatedAt: number): McpSource {
  const common = {
    id,
    name: flat.name.trim(),
    serverId: flat.serverId.trim(),
    enabled: flat.enabled,
    threadKeyPath: flat.threadKeyPath.trim(),
    senderPath: flat.senderPath.trim(),
    handler: flat.handler,
    createdAt,
    updatedAt,
  }
  if (flat.mode === "subscribe") {
    return { ...common, mode: "subscribe", resourceUris: flat.resourceUris.map((uri) => uri.trim()).filter((uri) => uri.length > 0) }
  }
  return {
    ...common,
    mode: "poll",
    tool: flat.tool.trim(),
    args: flat.args,
    cursorArg: flat.cursorArg.trim(),
    cursorPath: flat.cursorPath.trim(),
    itemsPath: flat.itemsPath.trim(),
    itemKeyPath: flat.itemKeyPath?.trim() || null,
    intervalMs: clampMcpSourceInterval(flat.intervalMs),
  }
}

function checked(source: McpSource): McpSource {
  const errors = validateMcpSource(source)
  if (errors.length > 0) throw new McpSourceValidationException({ code: "INVALID", message: errors.join("; ") })
  return source
}

export function createMcpSource(input: McpSourceInput): McpSource {
  const now = Date.now()
  return checked(assemble(flatten(input), randomUUID(), now, now))
}

export function updateMcpSource(existing: McpSource, patch: McpSourcePatch): McpSource {
  const { itemKeyPath, ...rest } = patch
  const merged: FlatSource = { ...flatten(existing), ...rest }
  if (itemKeyPath !== undefined) merged.itemKeyPath = itemKeyPath
  return checked(assemble(merged, existing.id, existing.createdAt, Date.now()))
}

export function mcpSourceNotFound(id: string): McpSourceValidationException {
  return new McpSourceValidationException({ code: "NOT_FOUND", message: `MCP source ${id} not found` })
}

export const MCP_SOURCE_CRUD = { create: createMcpSource, update: updateMcpSource, notFound: mcpSourceNotFound }

export function applyMcpSourceSetters(current: McpSource[], patch: McpSourcesPatch | undefined): McpSource[] {
  if (!patch?.setEnabled) return current
  const { id, enabled } = patch.setEnabled
  return current.map((source) => (source.id === id ? { ...source, enabled, updatedAt: Date.now() } : source))
}

export function checkMcpSourceServers(
  next: McpSource[],
  patch: McpSourcesPatch | undefined,
  servers: readonly McpServerConfig[],
): McpSource[] {
  const updatedId = patch?.update?.id
  const touched = patch?.create ? next.slice(-1) : next.filter((source) => source.id === updatedId)
  const missing = touched.find((source) => !servers.some((server) => server.id === source.serverId))
  if (missing) {
    throw new McpSourceValidationException({ code: "UNKNOWN_SERVER", message: `MCP server ${missing.serverId} does not exist` })
  }
  return next
}

function readString(object: JsonObject, key: string): string | undefined {
  const value = object[key]
  return typeof value === "string" ? value : undefined
}

function readHandler(value: JsonValue | undefined): InboundHandler | null {
  if (value === undefined || !isJsonObject(value)) return null
  const mode = readString(value, "mode")
  if (mode === undefined || !isInboundHandlerMode(mode)) return null
  const provider = readString(value, "provider")
  const model = readString(value, "model")
  const chatId = readString(value, "chatId")
  const projectId = readString(value, "projectId")
  return {
    ...EMPTY_HANDLER,
    mode,
    template: readString(value, "template") ?? "",
    replyHint: readString(value, "replyHint") ?? "",
    pushEnabled: value.pushEnabled !== false,
    ...(chatId ? { chatId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(provider && isAgentProvider(provider) && model ? { provider, model } : {}),
  }
}

function readStrings(value: JsonValue | undefined): string[] {
  if (value === undefined || !isJsonArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function readSource(raw: JsonObject): McpSource | null {
  const mode = readString(raw, "mode")
  const handler = readHandler(raw.handler)
  if (mode === undefined || !isMcpSourceMode(mode) || handler === null) return null
  const args = raw.args
  const itemKeyPath = readString(raw, "itemKeyPath")
  const interval = raw.intervalMs
  const flat: FlatSource = {
    mode,
    name: readString(raw, "name") ?? "",
    serverId: readString(raw, "serverId") ?? "",
    enabled: raw.enabled !== false,
    threadKeyPath: readString(raw, "threadKeyPath") ?? "",
    senderPath: readString(raw, "senderPath") ?? "",
    handler,
    resourceUris: readStrings(raw.resourceUris),
    tool: readString(raw, "tool") ?? "",
    args: args !== undefined && isJsonObject(args) ? args : {},
    cursorArg: readString(raw, "cursorArg") ?? "",
    cursorPath: readString(raw, "cursorPath") ?? "",
    itemsPath: readString(raw, "itemsPath") ?? "",
    itemKeyPath: itemKeyPath ?? null,
    intervalMs: typeof interval === "number" && Number.isFinite(interval) ? interval : MCP_SOURCE_INTERVAL_MIN_MS,
  }
  const id = readString(raw, "id")
  const created = raw.createdAt
  const updated = raw.updatedAt
  return assemble(
    flat,
    id && id.length > 0 ? id : randomUUID(),
    typeof created === "number" ? created : 0,
    typeof updated === "number" ? updated : 0,
  )
}

export function normalizeMcpSources(value: JsonValue | undefined, warnings: string[]): McpSource[] {
  if (value === undefined || value === null) return []
  if (!isJsonArray(value)) {
    warnings.push("mcpSources must be an array")
    return []
  }
  const out: McpSource[] = []
  for (const raw of value) {
    const source = isJsonObject(raw) ? readSource(raw) : null
    const errors = source ? validateMcpSource(source) : ["entry is malformed"]
    if (source === null || errors.length > 0 || out.some((entry) => entry.id === source.id)) {
      warnings.push(`mcpSources: dropped ${isJsonObject(raw) ? readString(raw, "name") ?? "entry" : "entry"} (${errors.join("; ") || "duplicate id"})`)
      continue
    }
    out.push(source)
  }
  return out
}
