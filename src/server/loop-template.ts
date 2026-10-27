
import path from "node:path"

import { DELEGATE_SUBAGENT_TOOL_NAME, STOP_LOOP_TOOL_NAME, TASK_CREATE_TOOL_NAME, TASK_LIST_TOOL_NAME, TASK_NOTE_TOOL_NAME, TASK_UPDATE_TOOL_NAME } from "../shared/tools"
import { LOOP_PARALLEL_STEP_INVARIANTS, LOOP_STEP_INVARIANTS } from "../shared/loop-progress"
import type { SeedTaskInput } from "../shared/chat-tasks/seed"
import { confinePathToDir, shellCommandIsParseable } from "./input-validation"
import { renderParallelLoopPrompt } from "./loop-prompt-parallel"

const DEFAULT_TRACKING_FILE = "PROGRESS.md"

export const MAX_PARALLELISM = 3

export const DEFAULT_INTEGRATION_BRANCH = "HEAD"

export interface LoopSetupInput {
  goal: string
  verifyCommand: string
  trackingFile?: string
  chunkHint?: string
  subagentId?: string
  workdir?: string
  parallelism?: number
  integrationBranch?: string
  force?: boolean
  tasks?: readonly SeedTaskInput[]
}

export interface LoopSetupContext {
  roster: readonly { id: string; name: string; triggerMode: "auto" | "manual" }[]
  defaultLoopSubagentId: string | null
}

export interface ResolvedLoopSetup {
  goal: string
  verifyCommand: string
  workdirAbs: string
  workdirRel: string
  trackingFileAbs: string
  trackingFileRel: string
  chunkHint: string | null
  subagentId: string
  parallelism: number
  integrationBranch: string
  prompt: string
}

export type LoopSetupValidation =
  | { ok: true; resolved: ResolvedLoopSetup }
  | { ok: false; errors: string[] }

function isNonBlankString<T>(v: T): v is T & string {
  return typeof v === "string" && v.trim().length > 0
}

function resolveTrackingFile(
  input: string | undefined,
  workdir: string,
): { abs: string; rel: string } | { error: string } {
  return confinePathToDir(input ?? DEFAULT_TRACKING_FILE, workdir, "trackingFile")
}

function renderLoopPrompt(args: {
  goal: string
  verifyCommand: string
  subagentId: string
  parallelism: number
  workdirRel: string
  integrationBranch?: string
}): string {
  if (args.parallelism > 1) return renderParallelLoopPrompt(args)
  const { goal, verifyCommand, subagentId, workdirRel } = args
  const workdirPhrase = workdirRel === "." ? "the project root" : workdirRel
  const workerPrompt = [
    "[chunk: <the subject of the task you are delegating>]",
    `Do the task named below. All work happens in ${workdirPhrase}.`,
    `To see the plan, call ${TASK_LIST_TOOL_NAME}({}) — the task list IS the plan; there is no file to read.`,
    `Verify your work with \`${verifyCommand}\` before you report success.`,
    "On success: commit all changes — run `git add -A && git commit -m \"<one-line task summary>\"` in the work directory; then call",
    `${TASK_UPDATE_TOOL_NAME}({ task_id: \\"<the task id>\\", status: \\"completed\\" })`,
    "and record what you did with",
    `${TASK_NOTE_TOOL_NAME}({ task_id: \\"<the task id>\\", kind: \\"progress\\", text: \\"<what changed>\\" }).`,
    "Before you mark the last task completed, run the TERMINAL CHECK: call",
    `${TASK_LIST_TOOL_NAME}({}) with NO status filter and confirm EVERY task is completed.`,
    "If any remains, leave it and let the orchestrator delegate it.",
    "If the work reveals a step nobody has planned yet, add it with",
    `${TASK_CREATE_TOOL_NAME}({ subject: \\"<the new step>\\" }) instead of doing it silently.`,
    "On failure: call",
    `${TASK_NOTE_TOOL_NAME}({ task_id: \\"<the task id>\\", kind: \\"failed_approach\\", text: \\"<what you tried and why it failed>\\" })`,
    "so the next iteration does not repeat it, and leave the task's status alone.",
    "Terminate when done.",
  ].join(" ")

  return [
    "You are the ORCHESTRATOR of an autonomous loop. You do NOT do the work",
    "yourself — you delegate it. Follow these steps EXACTLY every turn:",
    "",
    `1. Read the current plan: call ${TASK_LIST_TOOL_NAME}({}).`,
    "   The task list is your ONLY durable state. It survives the /clear between",
    "   turns, so it is where the plan lives — there is no tracking file.",
    `2. Run the verify command (the ORACLE) with Bash, from ${workdirPhrase}:`,
    `   \`${verifyCommand}\`. Check its exit code.`,
    "3. Decide, using BOTH signals — the oracle is only a proxy, the plan is the",
    "   authority. Four cases:",
    "   (a) oracle exited 0 AND no task is pending or in progress → run the",
    "       TERMINAL CHECK before declaring victory: call",
    `       ${TASK_LIST_TOOL_NAME}({}) with NO status filter and scan EVERY task.`,
    "       Any task still pending or in progress → treat as case (b).",
    `       Only if the whole plan is exhausted: run \`git log --oneline -20\` in`,
    `       ${workdirPhrase} to count the commits, then print a loop-end summary:`,
    "       how many commits were made, what each one covers, and what the user",
    "       should do next (push, open a PR, review manually, etc.).",
    `       Then print "GOAL MET: ${goal}",`,
    `       call ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN. Do NOT call`,
    "       delegate_subagent.",
    "   (b) oracle exited 0 BUT the plan still lists real work — or the TERMINAL",
    "       CHECK found an unfinished task → the oracle is too weak to define",
    "       done. Print \"ORACLE TOO WEAK: <what the plan still lists>\", call",
    `       ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN so a human can tighten`,
    "       it. Do NOT declare the goal met, and do NOT delegate.",
    "   (c) oracle failed AND a task is pending → normal case, go to step 4.",
    "   (d) oracle failed BUT no task is pending → the plan ran out while the",
    "       goal is unmet. Write the next step yourself with",
    `       ${TASK_CREATE_TOOL_NAME}({ subject: "<one concrete next step>" })`,
    "       then go to step 4.",
    "4. Mark the task you are about to delegate as in progress with",
    `   ${TASK_UPDATE_TOOL_NAME}({ task_id: "<id>", status: "in_progress" }), then`,
    "   delegate it with EXACTLY this call (the subagent is fixed by",
    "   configuration), making the ONE substitution marked below:",
    "",
    `     ${DELEGATE_SUBAGENT_TOOL_NAME}({`,
    `       subagent_id: "${subagentId}",`,
    "       run_in_background: true,",
    `       prompt: "${workerPrompt}",`,
    "     })",
    "",
    "   Replace `<the subject of the task you are delegating>` inside the leading",
    "   `[chunk: …]` marker with that task's subject, and name the task's id in",
    "   the prompt body wherever `<the task id>` appears. Those are the only",
    "   edits you make to that prompt — leave every other word verbatim.",
    "",
    "5. If THIS turn began with a task-notification reporting a FAILED run, class",
    "   the failure before you re-delegate:",
    "   - INFRA (AUTH_REQUIRED, CAP_EXCEEDED, DEPTH_EXCEEDED, timeout, spawn",
    "     failure): the work was never attempted. Re-delegate the SAME task",
    "     unchanged and do NOT call stop_loop — Kanna disarms the loop itself",
    "     after repeated failures, so stopping here just costs a human round-trip.",
    "   - WORK (the worker ran and could not finish): record it with",
    `     ${TASK_NOTE_TOOL_NAME}({ task_id: "<id>", kind: "failed_approach", text: "<reason>" })`,
    "     then delegate a DIFFERENT approach to the same task.",
    "6. End your turn. Kanna will /clear your context and re-fire this exact",
    "   prompt after the worker completes. Your ONLY durable state is the task",
    "   list — nothing you keep in your head survives.",
    "",
    "HARD RULES (do not violate):",
    "- You are the orchestrator. NEVER edit code yourself: do NOT use Edit,",
    "  Write, MultiEdit, or the Task/Agent tool. Kanna blocks these tools in",
    "  loop turns; attempting them wastes the turn.",
    `- Record progress ONLY through ${TASK_UPDATE_TOOL_NAME} and`,
    `  ${TASK_NOTE_TOOL_NAME}. A task's status cannot pile up the way a hand-`,
    "  written log could, which is why completed work never gets redone here.",
    "- Exactly ONE delegate_subagent per turn, then END THE TURN immediately.",
    "- All progress lives in the task list, never in your context.",
    "",
    `Goal (for reference): ${goal}`,
    `Verify command: \`${verifyCommand}\``,
    `Work directory: ${workdirRel}`,
  ].join("\n")
}

export function extractOracleScriptPath(verifyCommand: string): string | null {
  for (const raw of verifyCommand.split(/\s+/)) {
    const token = raw.replace(/^["']|["']$/g, "")
    if (token.startsWith("-")) continue
    if (/\.(?:sh|bash)$/.test(token)) return token
  }
  return null
}

const WEAK_ORACLE_PATTERNS: readonly RegExp[] = [
  /(?:^|[^\w-])test\s+(?:!\s+)?-[defs]\b/gm,
  /\[\[?\s+(?:!\s+)?-[defs]\s/gm,
  /(?:^|[^\w-])grep\s+(?:-\w+\s+)*-\w*[qcL]\w*(?=\s|$)/gm,
  /(?:^|[^\w-])ls\s+[^\n;|&]*\/dev\/null/gm,
]

const STRONG_ORACLE_PATTERNS: readonly RegExp[] = [
  /\bbun\s+(?:run\s+)?(?:test|check|lint|typecheck)\b/,
  /\btask\s+\S*(?:check|test)\S*/,
  /\b(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:test|check|lint|typecheck)\b/,
  /\b(?:vitest|jest|pytest|playwright|mocha|ava)\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+(?:test|check)\b/,
  /\bmvn\s+(?:test|verify)\b/,
  /\bmake\s+(?:test|check)\b/,
  /\btsc\b/,
  /\beslint\b/,
]

const WEAK_MARKER_SOFT_LIMIT = 3

export interface OracleAuditInput {
  verifyCommand: string
  scriptPath: string | null
  scriptContent: string | null
}

export function auditOracle(input: OracleAuditInput): string[] {
  if (input.scriptPath !== null && input.scriptContent === null) {
    return [
      `verify script ${input.scriptPath} could not be read at arm time, so its strength was`
      + " not audited — make sure it asserts behavior (tests), not file existence or greps.",
    ]
  }
  const text = input.scriptContent ?? input.verifyCommand
  const weak = WEAK_ORACLE_PATTERNS.reduce((n, p) => n + [...text.matchAll(p)].length, 0)
  if (weak === 0) return []
  const strong = STRONG_ORACLE_PATTERNS.some((p) => p.test(text))
  if (!strong) {
    return [
      `the oracle contains ${weak} file-existence/grep check(s) and no test-runner invocation,`
      + " so it can pass without the behavior existing. Prefer a RED test in the repo:"
      + " a grep is satisfied by an import line; a test is not.",
    ]
  }
  if (weak >= WEAK_MARKER_SOFT_LIMIT) {
    return [
      `the oracle gates its test run behind ${weak} file-existence/grep markers. Markers can`
      + " pass without behavior — make sure the suite itself contains RED tests for the"
      + " remaining work; a green legacy suite proves nothing about new work.",
    ]
  }
  return []
}

export function validateLoopSetup(
  input: LoopSetupInput,
  cwd: string,
  context: LoopSetupContext,
): LoopSetupValidation {
  const errors: string[] = []

  if (!isNonBlankString(input.goal)) {
    errors.push("goal is required and must be a non-empty string")
  }

  if (!isNonBlankString(input.verifyCommand)) {
    errors.push("verifyCommand is required and must be a non-empty string")
  } else if (!shellCommandIsParseable(input.verifyCommand)) {
    errors.push("verifyCommand is not a parseable shell command (unmatched quotes / empty)")
  }

  if (input.chunkHint !== undefined && typeof input.chunkHint !== "string") {
    errors.push("chunkHint must be a string when provided")
  }

  const requestedSubagentId = isNonBlankString(input.subagentId)
    ? input.subagentId.trim()
    : (context.defaultLoopSubagentId ?? null)
  if (!requestedSubagentId) {
    errors.push("subagentId is required: pass it explicitly or set a default loop subagent in Settings")
  } else {
    const worker = context.roster.find((s) => s.id === requestedSubagentId)
    if (!worker) {
      errors.push(`subagentId "${requestedSubagentId}" is not a known subagent`)
    } else if (worker.triggerMode === "manual") {
      errors.push(
        `subagent "${worker.name}" is manual-trigger and cannot be driven by a loop:`
        + " the loop delegates automatically, with no @-mention to authorize it."
        + " Switch it to auto in Settings → Subagents, or pick an auto subagent.",
      )
    }
  }

  let workdirAbs = cwd
  if (input.workdir !== undefined) {
    if (!isNonBlankString(input.workdir) || !path.isAbsolute(input.workdir)) {
      errors.push("workdir must be a non-empty absolute path when provided")
    } else {
      workdirAbs = path.normalize(input.workdir.trim())
    }
  }

  const parallelism = input.parallelism ?? 1
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > MAX_PARALLELISM) {
    errors.push(`parallelism must be an integer between 1 and ${MAX_PARALLELISM}`)
  }

  const resolved = resolveTrackingFile(input.trackingFile, workdirAbs)
  if ("error" in resolved) errors.push(resolved.error)

  if (errors.length > 0) return { ok: false, errors }
  if ("error" in resolved) return { ok: false, errors: [resolved.error] }
  if (requestedSubagentId === null) return { ok: false, errors: ["internal: subagentId unresolved"] }
  const subagentId = requestedSubagentId
  const workdirRel = workdirAbs === cwd ? "." : (path.relative(cwd, workdirAbs) || ".")

  const chunkHint = input.chunkHint?.trim() ? input.chunkHint.trim() : null
  const goal = input.goal.trim()
  const verifyCommand = input.verifyCommand.trim()
  const integrationBranch = isNonBlankString(input.integrationBranch)
    ? input.integrationBranch.trim()
    : DEFAULT_INTEGRATION_BRANCH
  const prompt = renderLoopPrompt({
    goal,
    verifyCommand,
    subagentId,
    parallelism,
    workdirRel,
    integrationBranch,
  })

  const invariants = parallelism > 1 ? LOOP_PARALLEL_STEP_INVARIANTS : LOOP_STEP_INVARIANTS
  const requiredSubstrings: readonly string[] = [
    verifyCommand,
    subagentId,
    ...invariants.flatMap((step) => step.requires),
  ]
  const missing = requiredSubstrings.filter((s) => !prompt.includes(s))
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [`internal: rendered template is missing required clauses: ${missing.join(", ")}`],
    }
  }

  return {
    ok: true,
    resolved: {
      goal,
      verifyCommand,
      workdirAbs,
      workdirRel,
      trackingFileAbs: resolved.abs,
      trackingFileRel: resolved.rel,
      chunkHint,
      subagentId,
      parallelism,
      integrationBranch,
      prompt,
    },
  }
}

export const __testing = { renderLoopPrompt, resolveTrackingFile }
