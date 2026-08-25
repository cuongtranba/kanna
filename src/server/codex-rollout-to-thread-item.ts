// src/server/codex-rollout-to-thread-item.ts
//
// A classified rollout tool record → the `ThreadItem` the LIVE codex path
// already speaks. PURE: no IO, no clock, no globals.
//
// WHY THIS EXISTS AT ALL, rather than a hand-rolled rollout→TranscriptEntry
// mapper: `translateItemToToolCalls` / `translateItemToToolResults`
// (`codex-transcript-translator.ts`) already own the whole
// `NormalizedToolCall` construction — `toolKind`, `toolName`, the `input`
// shape each card reads, the `toolId` join key. A second mapper would
// re-derive all of that and then drift, and the drift is invisible: the same
// `exec` renders as a Bash card in a live chat and as "unknown tool" in an
// imported one, with nothing failing anywhere. Mapping onto `ThreadItem`
// instead means there is exactly one place that decides what a codex tool
// looks like, and imported and live sessions cannot disagree.
//
// NOTHING HERE THROWS. Malformed `arguments` JSON, an unparseable patch, an
// output with no matching call — each degrades to a dynamic/unknown item. A
// rollout is other software's output and half of it is version-skewed; a
// parser that throws loses the whole session over one bad line.

import { type AnyValue, isRecord } from "../shared/errors"
import type {
  CommandExecutionItem,
  DynamicToolCallItem,
  FileChangeItem,
  ThreadItem,
  TurnPlanStep,
} from "./codex-app-server-protocol"
import { isUnifiedDiff } from "./codex-transcript-translator"
import type { CodexToolCallRecord, CodexToolOutputRecord } from "./codex-session-types"

/** Tool names that map to a `commandExecution` item rather than a dynamic one. */
const EXEC_TOOL_NAMES: ReadonlySet<string> = new Set(["exec", "exec_command"])
const APPLY_PATCH_TOOL_NAME = "apply_patch"
const UPDATE_PLAN_TOOL_NAME = "update_plan"

/**
 * What a `tool_call` record becomes.
 *
 * `update_plan` is NOT a `ThreadItem` — the live path renders a plan through
 * `todoToolCall` / `planStepsToTodos`, not through the item union — so it gets
 * its own variant carrying the parsed steps, and the mapper calls the existing
 * helpers with them.
 */
export type RolloutToolCallMapping =
  | { kind: "item"; item: ThreadItem }
  | { kind: "plan"; callId: string; steps: TurnPlanStep[]; explanation: string | null }

// ---------------------------------------------------------------------------
// exec
// ---------------------------------------------------------------------------

/**
 * `custom_tool_call{name:"exec"}` carries a JS SNIPPET, not a command:
 *
 *     const r = await tools.exec_command({
 *       cmd: "sed -n '1,240p' SKILL.md",
 *       workdir: "/Users/…",
 *     });
 *
 * so the command is the `cmd:` string literal inside it. A snippet with no
 * `cmd:` (the `tools.update_plan(...)` form does occur under `exec`) keeps the
 * whole snippet as the command — it IS what ran, and the card shows it.
 */
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

function commandExecutionCall(
  record: CodexToolCallRecord,
): { command: string; cwd: string | null } | null {
  if (record.family === "function") {
    // `function_call{name:"exec_command"}` — `arguments` is a JSON STRING.
    const args = parseJsonRecord(record.input)
    if (args === null) return null
    const command = stringOrNull(args.cmd)
    if (command === null) return null
    return { command, cwd: stringOrNull(args.workdir) }
  }
  const command = matchJsStringField(record.input, EXEC_CMD_PATTERN) ?? record.input
  return { command, cwd: matchJsStringField(record.input, EXEC_WORKDIR_PATTERN) }
}

// ---------------------------------------------------------------------------
// apply_patch
// ---------------------------------------------------------------------------

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

/**
 * `custom_tool_call{name:"apply_patch"}.input` is Codex's own patch envelope:
 *
 *     *** Begin Patch
 *     *** Update File: /abs/path
 *     @@
 *     -old
 *     +new
 *     *** End Patch
 *
 * Each file section becomes one `FileChangeItem.changes` entry whose `diff` is
 * the section body VERBATIM. The body is not parsed here — `fileChangeToToolCalls`
 * runs `isUnifiedDiff` / `parseUnifiedDiff` over it on the live path, and doing
 * it twice is exactly the drift this module exists to prevent. `isUnifiedDiff`
 * is only consulted to decide whether a non-delete section is a diff at all;
 * if it is not, the whole patch is unparseable and the caller degrades.
 *
 * Returns `null` for anything that is not a patch, so the caller can fall back.
 */
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
    // A delete section legitimately has no body; an add/update section that is
    // not a diff means the patch envelope did not survive whatever produced it.
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

// ---------------------------------------------------------------------------
// update_plan
// ---------------------------------------------------------------------------

function planStatus(raw: AnyValue): TurnPlanStep["status"] {
  if (raw === "completed") return "completed"
  if (raw === "in_progress" || raw === "inProgress") return "inProgress"
  return "pending"
}

/**
 * `function_call{name:"update_plan"}.arguments` is a JSON string holding
 * `{explanation, plan:[{step, status}]}`. `status` is snake_case on the
 * rollout (`in_progress`) where the app-server sends camelCase (`inProgress`);
 * both are accepted so a plan never silently renders every step as pending.
 */
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

// ---------------------------------------------------------------------------
// dynamic fallback
// ---------------------------------------------------------------------------

/**
 * `arguments` parsed when it is a JSON object, kept as the raw string when it
 * is not. `DynamicToolCallItem.arguments` accepts both, and the raw text is
 * strictly more informative than an empty object.
 */
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

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Map a `tool_call` record onto the item the live translator renders.
 *
 * `id` is the `call_id`, ALWAYS — it is the join key the client already uses
 * to pair a tool call with its result, and every item this returns must carry
 * the same one its `tool_output` sibling will.
 */
export function rolloutToolCallToThreadItem(
  record: CodexToolCallRecord,
): RolloutToolCallMapping {
  if (EXEC_TOOL_NAMES.has(record.name)) {
    const exec = commandExecutionCall(record)
    if (exec !== null) {
      const item: CommandExecutionItem = {
        type: "commandExecution",
        id: record.callId,
        command: exec.command,
        status: "inProgress",
        ...(exec.cwd === null ? {} : { cwd: exec.cwd }),
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

  return { kind: "item", item: dynamicCall(record) }
}

/** `{"output":"…","metadata":{"exit_code":0}}` — the shape `apply_patch` and
 * some `exec` outputs use. Absent everywhere else, and then the exit code is
 * simply unknown rather than guessed at. */
function exitCodeOf(output: string): number | null {
  const parsed = parseJsonRecord(output)
  if (parsed === null) return null
  const metadata = parsed.metadata
  if (!isRecord(metadata)) return null
  const code = metadata.exit_code
  return typeof code === "number" && Number.isFinite(code) ? code : null
}

function dynamicOutput(callId: string, tool: string, output: string): DynamicToolCallItem {
  return {
    type: "dynamicToolCall",
    id: callId,
    tool,
    status: "completed",
    contentItems: [{ type: "inputText", text: output }],
    success: true,
  }
}

/**
 * Map a `tool_output` record onto the COMPLETED form of the item its call
 * produced.
 *
 * `call` is the matching `tool_call` record and is OPTIONAL — a tool output
 * carries no tool name of its own, and the fallback is REQUIRED rather than
 * defensive: a live-tail delta can legitimately contain an output whose call
 * landed in a chunk already imported, so the pairing is genuinely absent. Then
 * it degrades to a `dynamicToolCall`-shaped item, which still carries the
 * `call_id` and so still joins to the right row.
 *
 * Passing the whole call record rather than just the name is what lets a
 * multi-file `apply_patch` reproduce the SAME `changes` array the call built —
 * `fileChangeToToolResults` derives per-change tool ids from its length, so a
 * different length silently orphans every result but the first.
 */
export function rolloutToolOutputToThreadItem(
  record: CodexToolOutputRecord,
  call: CodexToolCallRecord | null,
): ThreadItem {
  if (call === null) return dynamicOutput(record.callId, "unknown", record.output)

  if (EXEC_TOOL_NAMES.has(call.name)) {
    const exitCode = exitCodeOf(record.output)
    const item: CommandExecutionItem = {
      type: "commandExecution",
      id: record.callId,
      command: commandExecutionCall(call)?.command ?? "",
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

  return dynamicOutput(record.callId, call.name, record.output)
}
