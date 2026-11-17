import { computeCostUsd, resolveModelPrice } from "../shared/token-pricing"
import { timestamped } from "../shared/transcript-entry"
import { stringField, numberField, objectField, type JsonObject } from "../shared/json"
import type {
  ContextWindowUsageSnapshot,
  NormalizedToolCall,
  ProviderUsage,
  TranscriptEntry,
} from "../shared/types"
import { mirroredUsageSnapshot } from "./context-usage-snapshot"
import type { AcpSessionUpdate, AcpToolCall, AcpTurnUsage } from "./antigravity-acp-protocol"

export function antigravitySystemInitEntry(model: string): TranscriptEntry {
  return timestamped({
    kind: "system_init",
    provider: "antigravity",
    model,
    tools: ["Bash", "Read", "Write", "Edit", "ExitPlanMode"],
    agents: [],
    slashCommands: [],
    mcpServers: [],
  })
}

export function antigravityCompactBoundaryEntry(): TranscriptEntry {
  return timestamped({ kind: "compact_boundary", compactMetadata: { trigger: "manual" } })
}

function providerUsageOf(usage: AcpTurnUsage | null): ProviderUsage | undefined {
  if (usage === null) return undefined
  const cached = usage.cachedReadTokens ?? 0
  return {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens + cached } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.cachedReadTokens !== undefined ? { cachedInputTokens: usage.cachedReadTokens } : {}),
  }
}

export function antigravityResultEntry(args: {
  subtype: "success" | "cancelled" | "error"
  message: string
  usage: AcpTurnUsage | null
  model: string
}): TranscriptEntry {
  const usage = providerUsageOf(args.usage)
  const price = usage === undefined ? null : resolveModelPrice(args.model)
  const costUsd = usage !== undefined && price !== null ? computeCostUsd(usage, price) : undefined
  return timestamped({
    kind: "result",
    subtype: args.subtype,
    isError: args.subtype === "error",
    durationMs: 0,
    result: args.message,
    ...(usage !== undefined ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  })
}

function firstString(source: JsonObject, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringField(source, key)
    if (value !== undefined) return value
  }
  return undefined
}

function mcpToolOf(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp_")) return null
  const rest = name.slice("mcp_".length)
  const split = rest.indexOf("_")
  if (split <= 0 || split === rest.length - 1) return null
  return { server: rest.slice(0, split), tool: rest.slice(split + 1) }
}

function normalizeTool(call: AcpToolCall): NormalizedToolCall {
  const name = call.name ?? call.title ?? "tool"
  const input = call.rawInput
  const base = { kind: "tool" as const, toolId: call.id, rawInput: input }
  const path = firstString(input, ["Path", "AbsolutePath", "TargetFile", "FilePath"]) ?? call.paths[0]

  const command = firstString(input, ["CommandLine", "Command"]) ?? call.title
  if ((call.kind === "execute" || name === "run_command") && command !== null && command !== undefined) {
    return { ...base, toolKind: "bash", toolName: "Bash", input: { command } }
  }
  if (call.kind === "read" && path !== undefined) {
    return { ...base, toolKind: "read_file", toolName: "Read", input: { filePath: path } }
  }
  const content = firstString(input, ["Content", "CodeContent", "FileContent"])
  if (call.kind === "edit" && path !== undefined && content !== undefined) {
    return { ...base, toolKind: "write_file", toolName: "Write", input: { filePath: path, content } }
  }
  const oldString = firstString(input, ["Target", "TargetContent", "OldString"])
  const newString = firstString(input, ["Replacement", "ReplacementContent", "NewString"])
  if (call.kind === "edit" && path !== undefined && oldString !== undefined && newString !== undefined) {
    return { ...base, toolKind: "edit_file", toolName: "Edit", input: { filePath: path, oldString, newString } }
  }
  const mcp = mcpToolOf(name)
  if (mcp !== null) {
    return {
      ...base,
      toolKind: "mcp_generic",
      toolName: `mcp__${mcp.server}__${mcp.tool}`,
      input: { server: mcp.server, tool: mcp.tool, payload: input },
    }
  }
  return { ...base, toolKind: "unknown_tool", toolName: name, input: { payload: input } }
}

export interface AcpPlanProposal {
  plan: string
  summary?: string
}

function planProposalOf(call: AcpToolCall): AcpPlanProposal | null {
  const artifact = objectField(call.rawInput, "ArtifactMetadata")
  if (artifact === null || artifact.RequestFeedback !== true) return null
  const plan = stringField(call.rawInput, "Content")?.trim()
  if (!plan) return null
  const summary = stringField(artifact, "Summary")?.trim()
  return summary ? { plan, summary } : { plan }
}

function resultContent(call: AcpToolCall): string | JsonObject {
  const output = call.rawOutput === null ? undefined : stringField(call.rawOutput, "output")
  if (output !== undefined) return output
  const text = call.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
  if (text) return text
  const diff = call.content.find((item) => item.type === "diff")
  if (diff !== undefined && diff.type === "diff") {
    return { path: diff.path, newText: diff.newText, oldText: diff.oldText }
  }
  if (call.rawOutput !== null && Object.keys(call.rawOutput).length > 0) return call.rawOutput
  return ""
}

function toolResultEntry(call: AcpToolCall): TranscriptEntry {
  const exitCode = call.rawOutput === null ? undefined : numberField(call.rawOutput, "exit_code")
  return timestamped({
    kind: "tool_result",
    toolId: call.id,
    content: resultContent(call),
    isError: call.status === "failed" || (exitCode !== undefined && exitCode !== 0),
  })
}

export class AcpTurnTranslator {
  private text = ""
  private thought = ""
  private lastText = ""
  private readonly started = new Set<string>()
  private readonly resolved = new Set<string>()
  private latestUsage: ContextWindowUsageSnapshot | undefined
  private proposedPlan: AcpPlanProposal | null = null

  get planProposal(): AcpPlanProposal | null {
    if (this.proposedPlan !== null) return this.proposedPlan
    return this.lastText ? { plan: this.lastText } : null
  }

  get usage(): ContextWindowUsageSnapshot | undefined {
    return this.latestUsage
  }

  accept(update: AcpSessionUpdate): TranscriptEntry[] {
    switch (update.type) {
      case "message": {
        const entries = this.takeThought()
        this.text += update.text
        return entries
      }
      case "thought": {
        const entries = this.takeText()
        this.thought += update.text
        return entries
      }
      case "tool":
        return this.acceptTool(update.call)
      case "usage":
        return this.acceptUsage(update.used, update.size)
      case "config":
      case "ignored":
        return []
    }
  }

  flush(): TranscriptEntry[] {
    return [...this.takeThought(), ...this.takeText()]
  }

  private acceptTool(call: AcpToolCall): TranscriptEntry[] {
    const entries = this.flush()
    this.proposedPlan = planProposalOf(call) ?? this.proposedPlan
    if (!this.started.has(call.id)) {
      this.started.add(call.id)
      entries.push(timestamped({ kind: "tool_call", tool: normalizeTool(call) }))
    }
    const finished = call.status === "completed" || call.status === "failed"
    if (finished && !this.resolved.has(call.id)) {
      this.resolved.add(call.id)
      entries.push(toolResultEntry(call))
    }
    return entries
  }

  private acceptUsage(used: number, size: number | null): TranscriptEntry[] {
    if (used <= 0) return []
    const usage: ContextWindowUsageSnapshot = {
      ...mirroredUsageSnapshot({ usedTokens: used, compactsAutomatically: false }),
      ...(size !== null ? { maxTokens: size } : {}),
    }
    this.latestUsage = usage
    return [timestamped({ kind: "context_window_updated", usage })]
  }

  private takeText(): TranscriptEntry[] {
    const text = this.text.trim()
    this.text = ""
    if (!text) return []
    this.lastText = text
    return [timestamped({ kind: "assistant_text", text })]
  }

  private takeThought(): TranscriptEntry[] {
    const text = this.thought.trim()
    this.thought = ""
    if (!text) return []
    return [timestamped({ kind: "assistant_thinking", text })]
  }
}
