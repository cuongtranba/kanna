import { type AnyValue, isRecord } from "../shared/errors"
import { log } from "../shared/log"
import type {
  CollabAgentToolCallItem,
  CommandExecutionItem,
  DynamicToolCallItem,
  FileChangeItem,
  ThreadItem,
  TurnPlanStep,
} from "./codex-app-server-protocol"
import { isUnifiedDiff } from "./codex-transcript-translator"
import type { CodexToolCallRecord, CodexToolOutputRecord } from "./codex-session-types"

const EXEC_TOOL_NAMES: ReadonlySet<string> = new Set(["exec", "exec_command"])
const APPLY_PATCH_TOOL_NAME = "apply_patch"
const UPDATE_PLAN_TOOL_NAME = "update_plan"

const COLLAB_AGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "wait",
  "wait_agent",
  "spawn_agent",
  "send_message",
  "list_agents",
  "interrupt_agent",
])

const ROLLOUT_TO_COLLAB_TOOL: Readonly<Record<string, CollabAgentToolCallItem["tool"]>> = {
  wait: "wait",
  wait_agent: "wait",
  spawn_agent: "spawnAgent",
  send_message: "sendInput",
  interrupt_agent: "closeAgent",
  list_agents: "wait",
}

export type RolloutToolCallMapping =
  | { kind: "item"; item: ThreadItem }
  | { kind: "plan"; callId: string; steps: TurnPlanStep[]; explanation: string | null }

const EXEC_CMD_PATTERN = /\bcmd\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/
const EXEC_WORKDIR_PATTERN = /\bworkdir\s*:\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/

const JS_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
}

function unescapeJsString(raw: string): string {
  let out = ""
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]
    if (char !== "\\" || i === raw.length - 1) {
      out += char
      continue
    }
    i += 1
    const next = raw[i]
    out += JS_ESCAPES[next] ?? next
  }
  return out
}

function matchJsStringField(snippet: string, pattern: RegExp): string | null {
  const match = pattern.exec(snippet)
  const body = match?.[2]
  return body === undefined ? null : unescapeJsString(body)
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed: AnyValue = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function stringOrNull(value: AnyValue): string | null {
  return typeof value === "string" ? value : null
}

function exitCodeOf(rawOutput: string): number | null {
  const parsed = parseJsonRecord(rawOutput)
  if (parsed === null) return null
  const metadata = parsed.metadata
  if (!isRecord(metadata)) return null
  const code = metadata.exit_code
  return typeof code === "number" && Number.isFinite(code) ? code : null
}

function commandExecutionCall(
  record: CodexToolCallRecord,
  onRegexMiss?: () => void,
): { command: string; cwd: string | null } | null {
  if (record.family === "function") {
    const args = parseJsonRecord(record.input)
    if (args === null) return null
    const command = stringOrNull(args.cmd)
    if (command === null) return null
    return { command, cwd: stringOrNull(args.workdir) }
  }
  const extracted = matchJsStringField(record.input, EXEC_CMD_PATTERN)
  if (extracted === null) {
    onRegexMiss?.()
    return { command: record.input, cwd: matchJsStringField(record.input, EXEC_WORKDIR_PATTERN) }
  }
  return { command: extracted, cwd: matchJsStringField(record.input, EXEC_WORKDIR_PATTERN) }
}

const PATCH_BEGIN = "*** Begin Patch"
const PATCH_END = "*** End Patch"
const PATCH_FILE_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/
const PATCH_MOVE_HEADER = /^\*\*\* Move to: (.+)$/

type PatchChanges = FileChangeItem["changes"]

function patchKind(verb: string): "add" | "delete" | "update" {
  if (verb === "Add") return "add"
  if (verb === "Delete") return "delete"
  return "update"
}

export function parseApplyPatch(input: string): PatchChanges | null {
  if (!input.includes(PATCH_BEGIN)) return null
  const lines = input.split(/\r?\n/)
  const changes: PatchChanges = []

  let path: string | null = null
  let verb: "add" | "delete" | "update" = "update"
  let movePath: string | null = null
  let body: string[] = []

  const flush = () => {
    if (path === null) return
    const diff = body.join("\n")
    if (verb !== "delete" && !isUnifiedDiff(diff)) {
      path = null
      return
    }
    changes.push({
      path,
      kind: movePath === null ? verb : { type: verb, move_path: movePath },
      diff,
    })
    path = null
    movePath = null
    body = []
  }

  for (const line of lines) {
    if (line === PATCH_BEGIN) continue
    if (line === PATCH_END) break
    const header = PATCH_FILE_HEADER.exec(line)
    if (header) {
      flush()
      verb = patchKind(header[1])
      path = header[2]
      movePath = null
      body = []
      continue
    }
    const move = PATCH_MOVE_HEADER.exec(line)
    if (move && path !== null) {
      movePath = move[1]
      continue
    }
    if (path !== null) body.push(line)
  }
  flush()

  return changes.length > 0 ? changes : null
}

function planStatus(raw: AnyValue): TurnPlanStep["status"] {
  if (raw === "completed") return "completed"
  if (raw === "in_progress" || raw === "inProgress") return "inProgress"
  return "pending"
}

export function parsePlanSteps(
  input: string,
): { steps: TurnPlanStep[]; explanation: string | null } | null {
  const args = parseJsonRecord(input)
  if (args === null) return null
  const plan = args.plan
  if (!Array.isArray(plan)) return null
  const steps: TurnPlanStep[] = []
  for (const entry of plan) {
    if (!isRecord(entry)) continue
    const step = stringOrNull(entry.step)
    if (step === null) continue
    steps.push({ step, status: planStatus(entry.status) })
  }
  if (steps.length === 0) return null
  return { steps, explanation: stringOrNull(args.explanation) }
}

function dynamicArguments(record: CodexToolCallRecord): DynamicToolCallItem["arguments"] {
  if (record.family === "function") {
    const parsed = parseJsonRecord(record.input)
    if (parsed !== null) return parsed
  }
  return record.input
}

function dynamicCall(record: CodexToolCallRecord): DynamicToolCallItem {
  return {
    type: "dynamicToolCall",
    id: record.callId,
    tool: record.name,
    arguments: dynamicArguments(record),
    status: "inProgress",
  }
}

function dynamicOutput(callId: string, tool: string, rawOutput: string): DynamicToolCallItem {
  return {
    type: "dynamicToolCall",
    id: callId,
    tool,
    status: "completed",
    contentItems: [{ type: "inputText", text: rawOutput }],
    success: true,
  }
}

function collabAgentCall(record: CodexToolCallRecord): CollabAgentToolCallItem {
  const args = parseJsonRecord(record.input)
  const senderThreadId = stringOrNull(args?.sender_thread_id ?? null) ?? ""
  const rawReceivers = args?.receiver_thread_ids
  const receiverThreadIds = Array.isArray(rawReceivers)
    ? rawReceivers.filter((r): r is string => typeof r === "string")
    : []
  const tool = ROLLOUT_TO_COLLAB_TOOL[record.name] ?? "wait"
  return {
    type: "collabAgentToolCall",
    id: record.callId,
    tool,
    status: "inProgress",
    senderThreadId,
    receiverThreadIds,
    prompt: stringOrNull(args?.prompt ?? null),
  }
}

export interface RolloutMapper {
  rolloutToolCallToThreadItem(record: CodexToolCallRecord): RolloutToolCallMapping
  rolloutToolOutputToThreadItem(record: CodexToolOutputRecord, call: CodexToolCallRecord | null): ThreadItem
  getMissCount(): number
}

export function createRolloutMapper(): RolloutMapper {
  let missCount = 0

  function onRegexMiss(): void {
    missCount += 1
    if (missCount === 1) {
      log.warn(
        "[kanna/codex] exec-snippet regex miss — falling back to raw snippet as command." +
          " Codex may have changed the snippet shape.",
      )
    }
  }

  function mapToolCall(record: CodexToolCallRecord): RolloutToolCallMapping {
    if (EXEC_TOOL_NAMES.has(record.name)) {
      const exec = commandExecutionCall(record, onRegexMiss)
      if (exec !== null) {
        const item: CommandExecutionItem = {
          type: "commandExecution",
          id: record.callId,
          command: exec.command,
          status: "inProgress",
          cwd: exec.cwd ?? undefined,
        }
        return { kind: "item", item }
      }
      return { kind: "item", item: dynamicCall(record) }
    }

    if (record.name === APPLY_PATCH_TOOL_NAME) {
      const changes = parseApplyPatch(record.input)
      if (changes !== null) {
        const item: FileChangeItem = {
          type: "fileChange",
          id: record.callId,
          changes,
          status: "inProgress",
        }
        return { kind: "item", item }
      }
      return { kind: "item", item: dynamicCall(record) }
    }

    if (record.name === UPDATE_PLAN_TOOL_NAME) {
      const plan = parsePlanSteps(record.input)
      if (plan !== null) {
        return {
          kind: "plan",
          callId: record.callId,
          steps: plan.steps,
          explanation: plan.explanation,
        }
      }
      return { kind: "item", item: dynamicCall(record) }
    }

    if (COLLAB_AGENT_TOOL_NAMES.has(record.name)) {
      return { kind: "item", item: collabAgentCall(record) }
    }

    return { kind: "item", item: dynamicCall(record) }
  }

  function mapToolOutput(
    record: CodexToolOutputRecord,
    call: CodexToolCallRecord | null,
  ): ThreadItem {
    if (call === null) return dynamicOutput(record.callId, "unknown", record.output)

    if (EXEC_TOOL_NAMES.has(call.name)) {
      const exitCode = exitCodeOf(record.output)
      const item: CommandExecutionItem = {
        type: "commandExecution",
        id: record.callId,
        command: commandExecutionCall(call, onRegexMiss)?.command ?? "",
        status: exitCode !== null && exitCode !== 0 ? "failed" : "completed",
        aggregatedOutput: record.output,
        exitCode,
      }
      return item
    }

    if (call.name === APPLY_PATCH_TOOL_NAME) {
      const changes = parseApplyPatch(call.input)
      if (changes !== null) {
        const item: FileChangeItem = {
          type: "fileChange",
          id: record.callId,
          changes,
          status: "completed",
        }
        return item
      }
    }

    if (COLLAB_AGENT_TOOL_NAMES.has(call.name)) {
      const base = collabAgentCall(call)
      return {
        ...base,
        id: record.callId,
        status: "completed",
      }
    }

    return dynamicOutput(record.callId, call.name, record.output)
  }

  return {
    rolloutToolCallToThreadItem: mapToolCall,
    rolloutToolOutputToThreadItem: mapToolOutput,
    getMissCount: () => missCount,
  }
}

const _defaultMapper = createRolloutMapper()

export function rolloutToolCallToThreadItem(
  record: CodexToolCallRecord,
): RolloutToolCallMapping {
  return _defaultMapper.rolloutToolCallToThreadItem(record)
}

export function rolloutToolOutputToThreadItem(
  record: CodexToolOutputRecord,
  call: CodexToolCallRecord | null,
): ThreadItem {
  return _defaultMapper.rolloutToolOutputToThreadItem(record, call)
}
