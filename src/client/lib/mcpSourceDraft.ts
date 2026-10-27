import {
  decodeInboundModelChoice,
  encodeInboundModelChoice,
  inboundHandlerTarget,
  type InboundHandler,
  type InboundHandlerMode,
} from "../../shared/inbound/handler"
import { MCP_SOURCE_PRESETS } from "../../shared/mcp-sources/presets"
import {
  MCP_SOURCE_INTERVAL_MIN_MS,
  type McpSource,
  type McpSourceInput,
  type McpSourceMode,
  type McpSourcePatch,
} from "../../shared/mcp-sources/types"
import { parseMcpSourceArgs, validateMcpSource } from "../../shared/mcp-sources/validate"

export interface McpSourceDraft {
  name: string
  serverId: string
  mode: McpSourceMode
  resourceUris: string
  tool: string
  argsText: string
  cursorArg: string
  cursorPath: string
  itemsPath: string
  itemKeyPath: string
  intervalSeconds: string
  threadKeyPath: string
  senderPath: string
  handlerMode: InboundHandlerMode
  chatId: string
  projectId: string
  modelValue: string
  template: string
  replyHint: string
  pushEnabled: boolean
}

export const DEFAULT_MCP_SOURCE_TEMPLATE =
  "A new message arrived. Read it, decide whether the user needs to act, and draft a reply if one is appropriate."

const DEFAULT_INTERVAL_SECONDS = "30"

export function emptyMcpSourceDraft(): McpSourceDraft {
  return {
    name: "",
    serverId: "",
    mode: "subscribe",
    resourceUris: "",
    tool: "",
    argsText: "{}",
    cursorArg: "",
    cursorPath: "",
    itemsPath: "",
    itemKeyPath: "",
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    threadKeyPath: "",
    senderPath: "",
    handlerMode: "spawn",
    chatId: "",
    projectId: "",
    modelValue: "",
    template: DEFAULT_MCP_SOURCE_TEMPLATE,
    replyHint: "",
    pushEnabled: true,
  }
}

function handlerFields(handler: InboundHandler): Pick<McpSourceDraft, "handlerMode" | "chatId" | "projectId" | "modelValue" | "template" | "replyHint" | "pushEnabled"> {
  return {
    handlerMode: handler.mode,
    chatId: handler.chatId ?? "",
    projectId: handler.projectId ?? "",
    modelValue: handler.provider && handler.model ? encodeInboundModelChoice(handler.provider, handler.model) : "",
    template: handler.template,
    replyHint: handler.replyHint,
    pushEnabled: handler.pushEnabled,
  }
}

export function draftFromMcpSource(source: McpSource): McpSourceDraft {
  const base: McpSourceDraft = {
    ...emptyMcpSourceDraft(),
    name: source.name,
    serverId: source.serverId,
    mode: source.mode,
    threadKeyPath: source.threadKeyPath,
    senderPath: source.senderPath,
    ...handlerFields(source.handler),
  }
  if (source.mode === "subscribe") return { ...base, resourceUris: source.resourceUris.join("\n") }
  return {
    ...base,
    tool: source.tool,
    argsText: JSON.stringify(source.args, null, 2),
    cursorArg: source.cursorArg,
    cursorPath: source.cursorPath,
    itemsPath: source.itemsPath,
    itemKeyPath: source.itemKeyPath ?? "",
    intervalSeconds: String(Math.round(source.intervalMs / 1000)),
  }
}

export function applyZaloPreset(draft: McpSourceDraft): McpSourceDraft {
  const preset = MCP_SOURCE_PRESETS.zalo
  return {
    ...draft,
    name: draft.name.trim().length > 0 ? draft.name : preset.label,
    mode: preset.mode,
    tool: preset.tool,
    argsText: JSON.stringify(preset.args, null, 2),
    cursorArg: preset.cursorArg,
    cursorPath: preset.cursorPath,
    itemsPath: preset.itemsPath,
    itemKeyPath: preset.itemKeyPath,
    intervalSeconds: String(Math.round(preset.intervalMs / 1000)),
    threadKeyPath: preset.threadKeyPath,
    senderPath: preset.senderPath,
    ...handlerFields({ ...preset.handler, projectId: draft.projectId || undefined }),
  }
}

function handlerFromDraft(draft: McpSourceDraft): InboundHandler {
  const choice = draft.handlerMode === "notify" ? null : decodeInboundModelChoice(draft.modelValue)
  return {
    mode: draft.handlerMode,
    template: draft.template,
    replyHint: draft.replyHint,
    pushEnabled: draft.pushEnabled,
    ...inboundHandlerTarget(draft.handlerMode, draft.chatId, draft.projectId),
    ...(choice ? { provider: choice.provider, model: choice.model } : {}),
  }
}

export type McpSourceDraftResult = { ok: true; input: McpSourceInput } | { ok: false; errors: string[] }

export function mcpSourceInputFromDraft(draft: McpSourceDraft): McpSourceDraftResult {
  const common = {
    name: draft.name.trim(),
    serverId: draft.serverId,
    threadKeyPath: draft.threadKeyPath.trim(),
    senderPath: draft.senderPath.trim(),
    handler: handlerFromDraft(draft),
  }
  if (draft.mode === "subscribe") {
    const input: McpSourceInput = {
      ...common,
      mode: "subscribe",
      resourceUris: draft.resourceUris.split("\n").map((uri) => uri.trim()).filter((uri) => uri.length > 0),
    }
    const errors = validateMcpSource(input)
    return errors.length > 0 ? { ok: false, errors } : { ok: true, input }
  }
  const parsedArgs = parseMcpSourceArgs(draft.argsText)
  const seconds = Number(draft.intervalSeconds)
  const input: McpSourceInput = {
    ...common,
    mode: "poll",
    tool: draft.tool.trim(),
    args: "args" in parsedArgs ? parsedArgs.args : {},
    cursorArg: draft.cursorArg.trim(),
    cursorPath: draft.cursorPath.trim(),
    itemsPath: draft.itemsPath.trim(),
    itemKeyPath: draft.itemKeyPath.trim() || null,
    intervalMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : MCP_SOURCE_INTERVAL_MIN_MS,
  }
  const errors = [
    ...("error" in parsedArgs ? [parsedArgs.error] : []),
    ...(Number.isFinite(seconds) && seconds > 0 ? [] : ["Interval must be a number of seconds"]),
    ...validateMcpSource(input),
  ]
  return errors.length > 0 ? { ok: false, errors } : { ok: true, input }
}

export function mcpSourcePatchFromInput(input: McpSourceInput): McpSourcePatch {
  const { enabled: _enabled, ...patch } = input
  return patch
}
