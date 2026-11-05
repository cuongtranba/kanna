import { randomUUID } from "node:crypto"
import { isInboundHandlerMode, type InboundHandler } from "../shared/inbound/handler"
import { isInboxAutonomyLevel, isQuietTime, normalizeMcpSourceAutonomy, type McpSourceAutonomy } from "../shared/inbox/autonomy"
import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../shared/json"
import type { AppSettingsPatch } from "../shared/app-settings-types"
import type { McpServerConfig } from "../shared/mcp-types"
import {
  clampMcpSourceInterval,
  isMcpSourceMode,
  MCP_SOURCE_INTERVAL_MIN_MS,
  type McpReplyArg,
  type McpSource,
  type McpSourceInput,
  type McpSourcePatch,
  type McpSourceReply,
} from "../shared/mcp-sources/types"
import { readMcpReplyArg, validateMcpSource, validateMcpSourceReply } from "../shared/mcp-sources/validate"
import { isAgentProvider } from "../shared/types"

type McpSourcesPatch = NonNullable<AppSettingsPatch["mcpSources"]>

export class McpSourceValidationException extends Error {
  constructor(readonly validationError: { code: "INVALID" | "UNKNOWN_SERVER" | "NOT_FOUND"; message: string }) {
    super(validationError.message)
    this.name = "McpSourceValidationException"
  }
}

interface FlatSource
  extends Pick<McpSource, "name" | "serverId" | "enabled" | "threadKeyPath" | "senderPath" | "textPath" | "handler" | "reply" | "autonomy"> {
  mode: McpSourceInput["mode"]
  resourceUris: string[]
  tool: string
  args: JsonObject
  cursorArg: string
  cursorPath: string
  itemsPath: string
  itemKeyPath: string | null
  intervalMs: number
  resyncIntervalMs: number | null
}

const EMPTY_HANDLER: InboundHandler = { mode: "notify", template: "", replyHint: "", pushEnabled: true }

function flatten(source: McpSourceInput | McpSource): FlatSource {
  const common = {
    name: source.name,
    serverId: source.serverId,
    enabled: source.enabled ?? true,
    threadKeyPath: source.threadKeyPath,
    senderPath: source.senderPath,
    textPath: source.textPath ?? "",
    handler: source.handler,
    reply: source.reply ?? null,
    autonomy: normalizeMcpSourceAutonomy(source.autonomy),
  }
  if (source.mode === "subscribe") {
    const { resourceUris, itemsPath, itemKeyPath, resyncIntervalMs } = source
    return { ...common, mode: "subscribe", resourceUris, tool: "", args: {}, cursorArg: "", cursorPath: "", itemsPath: itemsPath ?? "", itemKeyPath: itemKeyPath ?? null, intervalMs: MCP_SOURCE_INTERVAL_MIN_MS, resyncIntervalMs: resyncIntervalMs ?? null }
  }
  const { tool, args, cursorArg, cursorPath, itemsPath, itemKeyPath, intervalMs } = source
  return { ...common, mode: "poll", resourceUris: [], tool, args, cursorArg, cursorPath, itemsPath, itemKeyPath, intervalMs, resyncIntervalMs: null }
}

function assemble(flat: FlatSource, id: string, createdAt: number, updatedAt: number): McpSource {
  const common = {
    id,
    name: flat.name.trim(),
    serverId: flat.serverId.trim(),
    enabled: flat.enabled,
    threadKeyPath: flat.threadKeyPath.trim(),
    senderPath: flat.senderPath.trim(),
    textPath: flat.textPath.trim(),
    handler: flat.handler,
    reply: flat.reply === null ? null : { ...flat.reply, tool: flat.reply.tool.trim(), resultIdPath: flat.reply.resultIdPath.trim() },
    autonomy: normalizeMcpSourceAutonomy(flat.autonomy),
    createdAt,
    updatedAt,
  }
  if (flat.mode === "subscribe") {
    return {
      ...common,
      mode: "subscribe",
      resourceUris: flat.resourceUris.map((uri) => uri.trim()).filter((uri) => uri.length > 0),
      itemsPath: flat.itemsPath.trim(),
      itemKeyPath: flat.itemKeyPath?.trim() || null,
      resyncIntervalMs: flat.resyncIntervalMs === null ? null : clampMcpSourceInterval(flat.resyncIntervalMs),
    }
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
  const { itemKeyPath, resyncIntervalMs, reply, autonomy, ...rest } = patch
  const merged: FlatSource = { ...flatten(existing), ...rest }
  if (reply !== undefined) merged.reply = reply
  if (autonomy !== undefined) merged.autonomy = normalizeMcpSourceAutonomy({ ...existing.autonomy, ...autonomy })
  if (itemKeyPath !== undefined) merged.itemKeyPath = itemKeyPath
  if (resyncIntervalMs !== undefined) merged.resyncIntervalMs = resyncIntervalMs
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
    ...(value.pushPreview === true ? { pushPreview: true } : {}),
    ...(chatId ? { chatId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(provider && isAgentProvider(provider) && model ? { provider, model } : {}),
  }
}

function readReply(value: JsonValue | undefined): McpSourceReply | null {
  if (value === undefined || !isJsonObject(value)) return null
  const tool = readString(value, "tool")
  const rawArgs = value.args
  if (tool === undefined || rawArgs === undefined || !isJsonObject(rawArgs)) return null
  const args: Record<string, McpReplyArg> = {}
  for (const [key, rawArg] of Object.entries(rawArgs)) {
    const arg = readMcpReplyArg(rawArg)
    if (arg === null) return null
    args[key] = arg
  }
  const reply: McpSourceReply = { tool, args, resultIdPath: readString(value, "resultIdPath") ?? "" }
  return validateMcpSourceReply(reply).length === 0 ? reply : null
}

function readAutonomy(value: JsonValue | undefined): McpSourceAutonomy {
  if (value === undefined || !isJsonObject(value)) return normalizeMcpSourceAutonomy(undefined)
  const level = readString(value, "level")
  const quiet = value.quietHours
  const start = quiet !== undefined && isJsonObject(quiet) ? readString(quiet, "start") : undefined
  const end = quiet !== undefined && isJsonObject(quiet) ? readString(quiet, "end") : undefined
  const quietHours = start !== undefined && end !== undefined && isQuietTime(start.trim()) && isQuietTime(end.trim()) ? { start, end } : null
  return normalizeMcpSourceAutonomy({
    ...(level !== undefined && isInboxAutonomyLevel(level) ? { level } : {}),
    ...(typeof value.threshold === "number" ? { threshold: value.threshold } : {}),
    ...(typeof value.perThreadPerHour === "number" ? { perThreadPerHour: value.perThreadPerHour } : {}),
    ...(typeof value.perSourcePerDay === "number" ? { perSourcePerDay: value.perSourcePerDay } : {}),
    ...(typeof value.maxChars === "number" ? { maxChars: value.maxChars } : {}),
    ...(typeof value.sendDelaySeconds === "number" ? { sendDelaySeconds: value.sendDelaySeconds } : {}),
    ...(typeof value.allowUrls === "boolean" ? { allowUrls: value.allowUrls } : {}),
    ...(typeof value.sendFromNotification === "boolean" ? { sendFromNotification: value.sendFromNotification } : {}),
    quietHours,
    allowlist: readStrings(value.allowlist),
  })
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
  const resync = raw.resyncIntervalMs
  const flat: FlatSource = {
    mode,
    name: readString(raw, "name") ?? "",
    serverId: readString(raw, "serverId") ?? "",
    enabled: raw.enabled !== false,
    threadKeyPath: readString(raw, "threadKeyPath") ?? "",
    senderPath: readString(raw, "senderPath") ?? "",
    textPath: readString(raw, "textPath") ?? "",
    handler,
    reply: readReply(raw.reply),
    autonomy: readAutonomy(raw.autonomy),
    resourceUris: readStrings(raw.resourceUris),
    tool: readString(raw, "tool") ?? "",
    args: args !== undefined && isJsonObject(args) ? args : {},
    cursorArg: readString(raw, "cursorArg") ?? "",
    cursorPath: readString(raw, "cursorPath") ?? "",
    itemsPath: readString(raw, "itemsPath") ?? "",
    itemKeyPath: itemKeyPath ?? null,
    intervalMs: typeof interval === "number" && Number.isFinite(interval) ? interval : MCP_SOURCE_INTERVAL_MIN_MS,
    resyncIntervalMs: typeof resync === "number" && Number.isFinite(resync) ? resync : null,
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
