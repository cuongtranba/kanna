import {
  decodeInboundModelChoice,
  encodeInboundModelChoice,
  inboundHandlerTarget,
  type InboundHandler,
  type InboundHandlerMode,
} from "../../shared/inbound/handler"
import { MCP_SOURCE_PRESETS, type McpSourcePresetId } from "../../shared/mcp-sources/presets"
import {
  MCP_SOURCE_INTERVAL_MIN_MS,
  type McpSource,
  type McpSourceInput,
  type McpSourceMode,
  type McpSourcePatch,
  type McpSourceReply,
} from "../../shared/mcp-sources/types"
import { autonomyDraftFrom, autonomyFromDraft, emptyAutonomyDraft, type McpSourceAutonomyDraft } from "./mcpSourceAutonomyDraft"
import { parseMcpReplyArgs, parseMcpSourceArgs, validateMcpSource } from "../../shared/mcp-sources/validate"

export interface McpSourceDraft extends McpSourceAutonomyDraft {
  name: string
  serverId: string
  mode: McpSourceMode
  resourceUris: string
  subscribeItemsPath: string
  subscribeItemKeyPath: string
  resyncSeconds: string
  tool: string
  argsText: string
  cursorArg: string
  cursorPath: string
  itemsPath: string
  itemKeyPath: string
  intervalSeconds: string
  threadKeyPath: string
  senderPath: string
  textPath: string
  handlerMode: InboundHandlerMode
  chatId: string
  projectId: string
  modelValue: string
  template: string
  replyHint: string
  pushEnabled: boolean
  replyTool: string
  replyArgsText: string
  replyResultIdPath: string
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
    subscribeItemsPath: "",
    subscribeItemKeyPath: "",
    resyncSeconds: "",
    tool: "",
    argsText: "{}",
    cursorArg: "",
    cursorPath: "",
    itemsPath: "",
    itemKeyPath: "",
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    threadKeyPath: "",
    senderPath: "",
    textPath: "",
    handlerMode: "spawn",
    chatId: "",
    projectId: "",
    modelValue: "",
    template: DEFAULT_MCP_SOURCE_TEMPLATE,
    replyHint: "",
    pushEnabled: true,
    ...replyFields(null),
    ...emptyAutonomyDraft(),
  }
}

function replyFields(reply: McpSourceReply | null): Pick<McpSourceDraft, "replyTool" | "replyArgsText" | "replyResultIdPath"> {
  return {
    replyTool: reply?.tool ?? "",
    replyArgsText: JSON.stringify(reply?.args ?? {}, null, 2),
    replyResultIdPath: reply?.resultIdPath ?? "",
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
    textPath: source.textPath,
    ...handlerFields(source.handler),
    ...replyFields(source.reply),
    ...autonomyDraftFrom(source.autonomy),
  }
  if (source.mode === "subscribe") {
    return {
      ...base,
      resourceUris: source.resourceUris.join("\n"),
      subscribeItemsPath: source.itemsPath,
      subscribeItemKeyPath: source.itemKeyPath ?? "",
      resyncSeconds: resyncSecondsText(source.resyncIntervalMs),
    }
  }
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

function resyncSecondsText(resyncIntervalMs: number | null): string {
  return resyncIntervalMs === null ? "" : String(Math.round(resyncIntervalMs / 1000))
}

export function applyPreset(draft: McpSourceDraft, presetId: McpSourcePresetId): McpSourceDraft {
  const preset = MCP_SOURCE_PRESETS[presetId]
  const common = {
    ...draft,
    name: draft.name.trim().length > 0 ? draft.name : preset.label,
    mode: preset.mode,
    threadKeyPath: preset.threadKeyPath,
    senderPath: preset.senderPath,
    textPath: preset.textPath ?? "",
    ...handlerFields({ ...preset.handler, projectId: draft.projectId || undefined }),
    ...replyFields(preset.reply ?? null),
  }
  if (preset.mode === "subscribe") {
    return {
      ...common,
      resourceUris: preset.resourceUris.join("\n"),
      subscribeItemsPath: preset.itemsPath ?? "",
      subscribeItemKeyPath: preset.itemKeyPath ?? "",
      resyncSeconds: resyncSecondsText(preset.resyncIntervalMs ?? null),
    }
  }
  return {
    ...common,
    tool: preset.tool,
    argsText: JSON.stringify(preset.args, null, 2),
    cursorArg: preset.cursorArg,
    cursorPath: preset.cursorPath,
    itemsPath: preset.itemsPath,
    itemKeyPath: preset.itemKeyPath ?? "",
    intervalSeconds: String(Math.round(preset.intervalMs / 1000)),
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

function replyFromDraft(draft: McpSourceDraft): { reply: McpSourceReply | null; errors: string[] } {
  const tool = draft.replyTool.trim()
  if (tool.length === 0) return { reply: null, errors: [] }
  const parsed = parseMcpReplyArgs(draft.replyArgsText)
  if ("error" in parsed) return { reply: null, errors: [parsed.error] }
  return { reply: { tool, args: parsed.args, resultIdPath: draft.replyResultIdPath.trim() }, errors: [] }
}

export type McpSourceDraftResult = { ok: true; input: McpSourceInput } | { ok: false; errors: string[] }

export function mcpSourceInputFromDraft(draft: McpSourceDraft): McpSourceDraftResult {
  const { reply, errors: replyErrors } = replyFromDraft(draft)
  const { autonomy, errors: autonomyErrors } = autonomyFromDraft(draft)
  const common = {
    name: draft.name.trim(),
    serverId: draft.serverId,
    threadKeyPath: draft.threadKeyPath.trim(),
    senderPath: draft.senderPath.trim(),
    textPath: draft.textPath.trim(),
    handler: handlerFromDraft(draft),
    reply,
    autonomy,
  }
  if (draft.mode === "subscribe") {
    const resyncText = draft.resyncSeconds.trim()
    const resyncSeconds = Number(resyncText)
    const resyncValid = resyncText.length === 0 || (Number.isFinite(resyncSeconds) && resyncSeconds > 0)
    const input: McpSourceInput = {
      ...common,
      mode: "subscribe",
      resourceUris: draft.resourceUris.split("\n").map((uri) => uri.trim()).filter((uri) => uri.length > 0),
      itemsPath: draft.subscribeItemsPath.trim(),
      itemKeyPath: draft.subscribeItemKeyPath.trim() || null,
      resyncIntervalMs: resyncText.length > 0 && resyncValid ? Math.round(resyncSeconds * 1000) : null,
    }
    const errors = [...(resyncValid ? [] : ["Resync interval must be a number of seconds"]), ...replyErrors, ...autonomyErrors, ...validateMcpSource(input)]
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
    ...replyErrors,
    ...autonomyErrors,
    ...validateMcpSource(input),
  ]
  return errors.length > 0 ? { ok: false, errors } : { ok: true, input }
}

export function mcpSourcePatchFromInput(input: McpSourceInput): McpSourcePatch {
  const { enabled: _enabled, ...patch } = input
  return patch
}
