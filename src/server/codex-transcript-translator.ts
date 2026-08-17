import { randomUUID } from "node:crypto"
import { computeCostUsd, type ModelPrice } from "../shared/token-pricing"
import { buildContentUrlForFilePath } from "../shared/projectFileUrl"
import type {
  AskUserQuestionItem,
  ContextWindowUsageSnapshot,
  ImageGenerationStatus,
  TodoItem,
  TranscriptEntry,
} from "../shared/types"
import { log } from "../shared/log"
import { type AnyValue, isRecord } from "../shared/errors"
import { codexErrorInfoTag } from "../shared/codex-error-classification"
import type {
  CollabAgentToolCallItem,
  DynamicToolCallOutputContentItem,
  McpToolCallItem,
  ThreadItem,
  ThreadTokenUsageUpdatedNotification,
  ToolRequestUserInputParams,
  ToolRequestUserInputQuestion,
  ToolRequestUserInputResponse,
  TurnPlanStep,
} from "./codex-app-server-protocol"

export interface TranslationContext {
  projectId: string | null
  cwd: string
  relocate(externalPath: string): string
}

export function createTranscriptEntry<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  entry: T,
  createdAt = Date.now()
): T & { _id: string; createdAt: number } {
  return {
    _id: randomUUID(),
    createdAt,
    ...entry,
  }
}

const timestamped = createTranscriptEntry

export function asRecord(value: AnyValue): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  return value
}

function asNumber(value: AnyValue): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function codexSystemInitEntry(model: string): TranscriptEntry {
  return timestamped({
    kind: "system_init",
    provider: "codex",
    model,
    tools: ["Bash", "Write", "Edit", "WebSearch", "TodoWrite", "AskUserQuestion", "ExitPlanMode"],
    agents: ["spawnAgent", "sendInput", "resumeAgent", "wait", "closeAgent"],
    slashCommands: [],
    mcpServers: [],
  })
}

export function normalizeCodexTokenUsage(
  notification: ThreadTokenUsageUpdatedNotification,
  resolveTurnPrice?: () => ModelPrice | null,
): ContextWindowUsageSnapshot | null {
  const usage = notification.tokenUsage
  const totalUsage = usage.total_token_usage ?? usage.total
  const lastUsage = usage.last_token_usage ?? usage.last

  const totalProcessedTokens = asNumber(totalUsage?.total_tokens) ?? asNumber(totalUsage?.totalTokens)
  const usedTokens = asNumber(lastUsage?.total_tokens) ?? asNumber(lastUsage?.totalTokens) ?? totalProcessedTokens
  if (usedTokens === undefined || usedTokens <= 0) {
    return null
  }

  const inputTokens = asNumber(lastUsage?.input_tokens) ?? asNumber(lastUsage?.inputTokens)
  const cachedInputTokens = asNumber(lastUsage?.cached_input_tokens) ?? asNumber(lastUsage?.cachedInputTokens)
  const outputTokens = asNumber(lastUsage?.output_tokens) ?? asNumber(lastUsage?.outputTokens)
  const reasoningOutputTokens =
    asNumber(lastUsage?.reasoning_output_tokens) ?? asNumber(lastUsage?.reasoningOutputTokens)
  const maxTokens = asNumber(usage.model_context_window) ?? asNumber(usage.modelContextWindow)

  let costUsd: number | undefined
  if (resolveTurnPrice) {
    const price = resolveTurnPrice()
    if (price) {
      costUsd = computeCostUsd(
        { inputTokens: inputTokens ?? 0, cachedInputTokens, outputTokens: outputTokens ?? 0 },
        price,
      )
    }
  }

  return {
    usedTokens,
    ...(totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens ? { totalProcessedTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    ...(inputTokens !== undefined ? { lastInputTokens: inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { lastCachedInputTokens: cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { lastReasoningOutputTokens: reasoningOutputTokens } : {}),
    lastUsedTokens: usedTokens,
    compactsAutomatically: true,
    ...(costUsd !== undefined ? { costUsd } : {}),
  }
}

function todoStatus(status: TurnPlanStep["status"]): TodoItem["status"] {
  if (status === "completed") return "completed"
  if (status === "inProgress") return "in_progress"
  return "pending"
}

export function planStepsToTodos(steps: TurnPlanStep[]): TodoItem[] {
  return steps.map((step) => ({
    content: step.step,
    status: todoStatus(step.status),
    activeForm: step.step,
  }))
}

export function renderPlanMarkdownFromSteps(steps: TurnPlanStep[]): string {
  return steps.map((step) => {
    const checkbox = step.status === "completed" ? "[x]" : "[ ]"
    return `- ${checkbox} ${step.step}`
  }).join("\n")
}

const warnedUnknownItemTypes = new Set<string>()

function warnUnknownItemType(item: ThreadItem) {
  const type = ("type" in item && typeof item.type === "string" ? item.type : null) ?? "<missing>"
  if (warnedUnknownItemTypes.has(type)) return
  warnedUnknownItemTypes.add(type)
  log.warn(`[codex-app-server] unknown ThreadItem type "${type}"; emitting generic tool placeholder. Update protocol bindings.`)
}

function fallbackToolNameForItem(item: ThreadItem): string {
  const type = ("type" in item && typeof item.type === "string" ? item.type : null) ?? "Unknown"
  return type.charAt(0).toUpperCase() + type.slice(1)
}

export function webSearchQuery(item: Extract<ThreadItem, { type: "webSearch" }>): string {
  return item.query || item.action?.query || item.action?.queries?.find((query) => typeof query === "string") || ""
}

function dynamicContentToText(contentItems: DynamicToolCallOutputContentItem[] | null | undefined): string {
  if (!contentItems?.length) return ""
  return contentItems
    .map((item) => item.type === "inputText" ? item.text ?? "" : item.imageUrl ?? "")
    .filter(Boolean)
    .join("\n")
}

export function dynamicToolPayload(value: Record<string, unknown> | unknown[] | string | number | boolean | null | undefined): Record<string, unknown> {
  const record = asRecord(value)
  if (record) return record
  return { value }
}

export function genericDynamicToolCall(toolId: string, toolName: string, input: Record<string, unknown>): TranscriptEntry {
  return timestamped({
    kind: "tool_call",
    tool: {
      kind: "tool",
      toolKind: "unknown_tool",
      toolName,
      toolId,
      input: {
        payload: input,
      },
      rawInput: input,
    },
  })
}

export const IMAGE_GENERATION_TOOL_NAME = "ImageGeneration"

export const DEFERRED_DYNAMIC_TOOLS: ReadonlySet<string> = new Set([IMAGE_GENERATION_TOOL_NAME])

function normalizeImageGenerationStatus(raw: AnyValue): ImageGenerationStatus {
  if (raw === "completed" || raw === "failed") return raw
  return "in_progress"
}

function imageGenerationInputFromArgs(args: AnyValue): { revisedPrompt: string | null; status: ImageGenerationStatus } {
  const record = asRecord(args)
  return {
    revisedPrompt: typeof record?.revisedPrompt === "string" ? record.revisedPrompt : null,
    status: normalizeImageGenerationStatus(record?.status),
  }
}

function imageGenerationToolCallFromDynamic(item: Extract<ThreadItem, { type: "dynamicToolCall" }>): TranscriptEntry {
  const input = imageGenerationInputFromArgs(item.arguments)
  return timestamped({
    kind: "tool_call",
    tool: {
      kind: "tool",
      toolKind: "image_generation",
      toolName: IMAGE_GENERATION_TOOL_NAME,
      toolId: item.id,
      input,
      rawInput: input,
    },
  })
}

function imageGenerationToolCallFromTyped(item: Extract<ThreadItem, { type: "imageGeneration" }>): TranscriptEntry {
  const input = {
    revisedPrompt: item.revisedPrompt ?? null,
    status: normalizeImageGenerationStatus(item.status),
  }
  return timestamped({
    kind: "tool_call",
    tool: {
      kind: "tool",
      toolKind: "image_generation",
      toolName: IMAGE_GENERATION_TOOL_NAME,
      toolId: item.id,
      input,
      rawInput: input,
    },
  })
}

function relativePathFromContentItems(contentItems: DynamicToolCallOutputContentItem[] | null | undefined): string | null {
  if (!contentItems?.length) return null
  for (const entry of contentItems) {
    if (entry.type !== "inputText" || typeof entry.text !== "string") continue
    const text = entry.text.trim()
    if (!text) continue
    return text
  }
  return null
}

function buildImageGenerationResult(
  toolId: string,
  relativePath: string | null,
  projectId: string | null,
  upstreamError: boolean,
): TranscriptEntry {
  const rel = relativePath ?? ""
  const fileName = rel ? rel.split("/").pop() ?? rel : ""
  const contentUrl = buildContentUrlForFilePath(projectId, rel) ?? ""
  const isError = upstreamError || !contentUrl
  return timestamped({
    kind: "tool_result",
    toolId,
    content: { contentUrl, relativePath: rel, fileName },
    isError,
  })
}

function collabToolCall(item: CollabAgentToolCallItem): TranscriptEntry {
  return timestamped({
    kind: "tool_call",
    tool: {
      kind: "tool",
      toolKind: "subagent_task",
      toolName: "Task",
      toolId: item.id,
      input: {
        subagentType: item.tool,
      },
      rawInput: isRecord(item) ? item : {},
    },
  })
}

export function todoToolCall(toolId: string, steps: TurnPlanStep[]): TranscriptEntry {
  return timestamped({
    kind: "tool_call",
    tool: {
      kind: "tool",
      toolKind: "todo_write",
      toolName: "TodoWrite",
      toolId,
      input: {
        todos: planStepsToTodos(steps),
      },
      rawInput: {
        plan: steps,
      },
    },
  })
}

function fileChangeKind(
  kind: "add" | "delete" | "update" | { type: "add" | "delete" | "update"; move_path?: string | null }
): { type: "add" | "delete" | "update"; movePath?: string | null } {
  if (typeof kind === "string") {
    return { type: kind }
  }
  return {
    type: kind.type,
    movePath: kind.move_path ?? null,
  }
}

function fileChangeToolId(itemId: string, index: number, totalChanges: number): string {
  if (totalChanges === 1) {
    return itemId
  }
  return `${itemId}:change:${index}`
}

function fileChangePayload(
  item: Extract<ThreadItem, { type: "fileChange" }>,
  change: Extract<ThreadItem, { type: "fileChange" }>["changes"][number]
): Record<string, unknown> {
  const payload = { ...item, changes: [change] }
  return isRecord(payload) ? payload : {}
}

function parseUnifiedDiff(diff: string): { oldString: string; newString: string } {
  const oldLines: string[] = []
  const newLines: string[] = []

  for (const line of diff.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) continue
    if (line === "\\ No newline at end of file") continue

    const prefix = line[0]
    const content = line.slice(1)

    if (prefix === " ") {
      oldLines.push(content)
      newLines.push(content)
      continue
    }
    if (prefix === "-") {
      oldLines.push(content)
      continue
    }
    if (prefix === "+") {
      newLines.push(content)
    }
  }

  return {
    oldString: oldLines.join("\n"),
    newString: newLines.join("\n"),
  }
}

function isUnifiedDiff(diff: string) {
  return diff.includes("@@")
    || diff.startsWith("---")
    || diff.startsWith("+++")
    || diff.split(/\r?\n/).some((line) => (
      line.startsWith("+")
      || line.startsWith("-")
      || line.startsWith(" ")
      || line === "\\ No newline at end of file"
    ))
}

function fileChangeToToolCalls(item: Extract<ThreadItem, { type: "fileChange" }>): TranscriptEntry[] {
  return item.changes.map((change, index) => {
    const payload = fileChangePayload(item, change)
    const toolId = fileChangeToolId(item.id, index, item.changes.length)
    const normalizedKind = fileChangeKind(change.kind)

    if (normalizedKind.movePath) {
      return timestamped({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "unknown_tool",
          toolName: "FileChange",
          toolId,
          input: {
            payload,
          },
          rawInput: payload,
        },
      })
    }

    if (typeof change.diff === "string") {
      const diffIsUnified = isUnifiedDiff(change.diff)
      const { oldString, newString } = diffIsUnified
        ? parseUnifiedDiff(change.diff)
        : { oldString: change.diff, newString: change.diff }

      if (normalizedKind.type === "add") {
        return timestamped({
          kind: "tool_call",
          tool: {
            kind: "tool",
            toolKind: "write_file",
            toolName: "Write",
            toolId,
            input: {
              filePath: change.path,
              content: newString,
            },
            rawInput: payload,
          },
        })
      }

      if (normalizedKind.type === "update") {
        if (!diffIsUnified) {
          return timestamped({
            kind: "tool_call",
            tool: {
              kind: "tool",
              toolKind: "unknown_tool",
              toolName: "FileChange",
              toolId,
              input: {
                payload,
              },
              rawInput: payload,
            },
          })
        }

        return timestamped({
          kind: "tool_call",
          tool: {
            kind: "tool",
            toolKind: "edit_file",
            toolName: "Edit",
            toolId,
            input: {
              filePath: change.path,
              oldString,
              newString,
            },
            rawInput: payload,
          },
        })
      }

      if (normalizedKind.type === "delete") {
        return timestamped({
          kind: "tool_call",
          tool: {
            kind: "tool",
            toolKind: "delete_file",
            toolName: "Delete",
            toolId,
            input: {
              filePath: change.path,
              content: oldString,
            },
            rawInput: payload,
          },
        })
      }
    }

    return timestamped({
      kind: "tool_call",
      tool: {
        kind: "tool",
        toolKind: "unknown_tool",
        toolName: "FileChange",
        toolId,
        input: {
          payload,
        },
        rawInput: payload,
      },
    })
  })
}

function fileChangeToToolResults(item: Extract<ThreadItem, { type: "fileChange" }>): TranscriptEntry[] {
  return item.changes.map((change, index) => timestamped({
    kind: "tool_result",
    toolId: fileChangeToolId(item.id, index, item.changes.length),
    content: fileChangePayload(item, change),
    isError: item.status === "failed" || item.status === "declined",
  }))
}

export function translateItemToToolCalls(item: ThreadItem, _projectId: string | null): TranscriptEntry[] {
  switch (item.type) {
    case "userMessage":
    case "reasoning":
    case "agentMessage":
      return []
    case "dynamicToolCall":
      if (item.tool === IMAGE_GENERATION_TOOL_NAME) {
        return [imageGenerationToolCallFromDynamic(item)]
      }
      return [genericDynamicToolCall(item.id, item.tool, dynamicToolPayload(item.arguments))]
    case "collabAgentToolCall":
      return [collabToolCall(item)]
    case "commandExecution":
      return [timestamped({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "bash",
          toolName: "Bash",
          toolId: item.id,
          input: {
            command: item.command,
          },
          rawInput: Object.fromEntries(Object.entries(item)),
        },
      })]
    case "webSearch":
      return [timestamped({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "web_search",
          toolName: "WebSearch",
          toolId: item.id,
          input: {
            query: webSearchQuery(item),
          },
          rawInput: Object.fromEntries(Object.entries(item)),
        },
      })]
    case "mcpToolCall":
      return [timestamped({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "mcp_generic",
          toolName: `mcp__${item.server}__${item.tool}`,
          toolId: item.id,
          input: {
            server: item.server,
            tool: item.tool,
            payload: item.arguments ?? {},
          },
          rawInput: item.arguments ?? {},
        },
      })]
    case "fileChange":
      return fileChangeToToolCalls(item)
    case "plan":
      return []
    case "error":
      return [timestamped({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "unknown_tool",
          toolName: "Error",
          toolId: item.id,
          input: {
            payload: isRecord(item) ? item : {},
          },
          rawInput: isRecord(item) ? item : {},
        },
      })]
    case "imageGeneration":
      return [imageGenerationToolCallFromTyped(item)]
    case "imageView":
      return [timestamped({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "unknown_tool",
          toolName: "ImageView",
          toolId: item.id,
          input: {
            payload: { path: item.path },
          },
          rawInput: isRecord(item) ? item : {},
        },
      })]
    default: {
      warnUnknownItemType(item)
      const record: Record<string, unknown> = isRecord(item) ? item : {}
      const id = typeof record.id === "string" ? record.id : `unknown-${randomUUID()}`
      return [timestamped({
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "unknown_tool",
          toolName: fallbackToolNameForItem(item),
          toolId: id,
          input: {
            payload: record,
          },
          rawInput: record,
        },
      })]
    }
  }
}

export function translateItemToToolResults(item: ThreadItem, ctx: TranslationContext): TranscriptEntry[] {
  switch (item.type) {
    case "userMessage":
    case "reasoning":
    case "agentMessage":
      return []
    case "dynamicToolCall":
      if (item.tool === IMAGE_GENERATION_TOOL_NAME) {
        const isError = item.status === "failed" || item.success === false
        const rawRel = relativePathFromContentItems(item.contentItems)
        const resolvedRel = rawRel ? ctx.relocate(rawRel) : rawRel
        return [buildImageGenerationResult(item.id, resolvedRel, ctx.projectId, isError)]
      }
      return [timestamped({
        kind: "tool_result",
        toolId: item.id,
        content: dynamicContentToText(item.contentItems) || Object.fromEntries(Object.entries(item)),
        isError: item.status === "failed" || item.success === false,
      })]
    case "collabAgentToolCall":
      return [timestamped({
        kind: "tool_result",
        toolId: item.id,
        content: Object.fromEntries(Object.entries(item)),
        isError: item.status === "failed",
      })]
    case "commandExecution":
      return [timestamped({
        kind: "tool_result",
        toolId: item.id,
        content: item.aggregatedOutput ?? Object.fromEntries(Object.entries(item)),
        isError: (typeof item.exitCode === "number" && item.exitCode !== 0) || item.status === "failed" || item.status === "declined",
      })]
    case "webSearch":
      return [timestamped({
        kind: "tool_result",
        toolId: item.id,
        content: Object.fromEntries(Object.entries(item)),
      })]
    case "mcpToolCall": {
      const mcpContent = contentFromMcpResult(item)
      return [timestamped({
        kind: "tool_result",
        toolId: item.id,
        content: normalizeMcpContent(mcpContent),
        isError: item.status === "failed",
      })]
    }
    case "fileChange":
      return fileChangeToToolResults(item)
    case "plan":
      return []
    case "error":
      return [timestamped({
        kind: "tool_result",
        toolId: item.id,
        content: item.message,
        isError: true,
      })]
    case "imageGeneration": {
      const rel = item.savedPath ?? item.result ?? null
      const resolvedRel = rel ? ctx.relocate(rel) : rel
      const isError = item.status === "failed"
      return [buildImageGenerationResult(item.id, resolvedRel, ctx.projectId, isError)]
    }
    case "imageView":
      return [timestamped({
        kind: "tool_result",
        toolId: item.id,
        content: item.path,
      })]
    default: {
      const record: Record<string, unknown> = isRecord(item) ? item : {}
      const id = typeof record.id === "string" ? record.id : `unknown-${randomUUID()}`
      return [timestamped({
        kind: "tool_result",
        toolId: id,
        content: record,
      })]
    }
  }
}

const MULTI_SELECT_HINT_PATTERN = /\b(all that apply|select all|choose all|pick all|select multiple|choose multiple|pick multiple|multiple selections?|multiple choice|more than one|one or more)\b/i

function inferQuestionAllowsMultiple(question: ToolRequestUserInputQuestion): boolean {
  const combinedText = [question.header, question.question].filter(Boolean).join(" ")
  return MULTI_SELECT_HINT_PATTERN.test(combinedText)
}

export function toAskUserQuestionItems(params: ToolRequestUserInputParams): AskUserQuestionItem[] {
  return params.questions.map((question) => ({
    id: question.id,
    question: question.question,
    header: question.header || undefined,
    options: question.options?.map((option) => ({
      label: option.label,
      description: option.description ?? undefined,
    })),
    multiSelect: inferQuestionAllowsMultiple(question),
  }))
}

export function toToolRequestUserInputResponse(raw: AnyValue, questions: ToolRequestUserInputParams["questions"]): ToolRequestUserInputResponse {
  const record = isRecord(raw) ? raw : {}
  const answersValue = record.answers
  const value = isRecord(answersValue) ? answersValue : record
  const answers = Object.fromEntries(
    questions.map((question) => {
      const rawAnswer = value[question.id] ?? value[question.question]
      if (Array.isArray(rawAnswer)) {
        return [question.id, { answers: rawAnswer.map((entry) => String(entry)) }]
      }
      if (typeof rawAnswer === "string") {
        return [question.id, { answers: [rawAnswer] }]
      }
      if (isRecord(rawAnswer) && Array.isArray(rawAnswer.answers)) {
        return [question.id, { answers: rawAnswer.answers.map((entry) => String(entry)) }]
      }
      return [question.id, { answers: [] }]
    })
  )
  return { answers }
}

function normalizeMcpContent(v: AnyValue): string | Record<string, AnyValue> | AnyValue[] | null {
  if (typeof v === "string") return v
  if (isRecord(v)) return v
  if (Array.isArray(v)) return v
  return null
}

function contentFromMcpResult(item: McpToolCallItem): AnyValue {
  if (item.error?.message) {
    return { error: item.error.message }
  }
  return item.result?.structuredContent ?? item.result?.content ?? null
}

export function buildResultEntry(
  subtype: "cancelled" | "error" | "success",
  errorMessage: string,
  errorInfo: Parameters<typeof codexErrorInfoTag>[0],
  lastUsageSnapshot: ContextWindowUsageSnapshot | undefined,
): TranscriptEntry {
  const last = lastUsageSnapshot
  const resultUsage = last
    ? {
        ...(last.inputTokens !== undefined ? { inputTokens: last.inputTokens } : {}),
        ...(last.outputTokens !== undefined ? { outputTokens: last.outputTokens } : {}),
        ...(last.cachedInputTokens !== undefined ? { cachedInputTokens: last.cachedInputTokens } : {}),
      }
    : undefined
  const errorInfoTag = codexErrorInfoTag(errorInfo)
  return timestamped({
    kind: "result",
    subtype,
    isError: subtype === "error",
    durationMs: 0,
    result: errorMessage,
    ...(resultUsage !== undefined ? { usage: resultUsage } : {}),
    ...(last?.costUsd !== undefined ? { costUsd: last.costUsd } : {}),
    ...(errorInfoTag !== null ? { codexErrorInfo: errorInfoTag } : {}),
  })
}
