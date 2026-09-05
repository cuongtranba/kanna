
import type { TranscriptEntry } from "../shared/types"
import type { Subagent, AgentProvider } from "../shared/types"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "./auto-continue/events"
import { deriveChatSchedules, deriveLastLoopSpec, deriveLoopState, type LoopSpec, type LoopState } from "./auto-continue/read-model"
import { clearClaudeSessionContext } from "./claude-context-commands"
import { timestamped } from "./claude-message-normalizer"
import { buildTaskNotification, resolveSpawnPaths } from "./claude-session-config"
import {
  assertTrackingFileSafe,
  auditOracle,
  extractOracleScriptPath,
  validateLoopSetup,
  reconcileTrackingFile,
  type LoopSetupInput,
} from "./loop-template"
import type {
  EnsureTrackingFileArgs,
  EnsureTrackingFileResult,
  TrackingFileInspection,
} from "./loop-template-io.adapter"
import type { RunVerifyArgs, RunVerifyResult } from "./loop-verify-io.adapter"
import type { BackgroundRunOutcome } from "./subagent-orchestrator"
import type { ClaudeSessionState } from "./claude-session-state"
import type { ArmedLoopInfo, SetupLoopHandlerResult } from "./kanna-mcp"
import type { ChatRecord } from "./events"
import { log } from "../shared/log"
import { withSpan } from "./observability"


interface LoopCommandStore {
  getChat(chatId: string): Pick<ChatRecord, "id" | "projectId" | "stackBindings"> | null
  getProject(projectId: string): { localPath: string; id: string } | null
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  setSessionTokenForProvider(chatId: string, provider: AgentProvider, token: string | null): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  listAutoContinueChats(): string[]
  getQueuedMessages(chatId: string): readonly { id: string }[]
  getSubagentRuns(chatId: string): Record<string, { status: string }>
}


export interface LoopCommandDeps {
  store: LoopCommandStore

  claudeSessions: Pick<Map<string, ClaudeSessionState>, "get">

  activeTurns: { has(chatId: string): boolean }

  startingTurns: { has(chatId: string): boolean }

  pendingTools: { has(chatId: string): boolean }

  hasLiveWorkflow: (chatId: string) => boolean

  hasPendingBackgroundTask: (session: ClaudeSessionState, now: number) => boolean

  getSubagents(): Subagent[]

  getAppSettingsSnapshot(): {
    subagentRuntime?: {
      defaultLoopSubagentId?: string | null
    } | null
  }

  closeClaudeSession(chatId: string, session: ClaudeSessionState): void

  emitAutoContinueEvent(event: AutoContinueEvent): Promise<void>

  ensureTrackingFile(args: EnsureTrackingFileArgs): Promise<EnsureTrackingFileResult>

  inspectTrackingFile(absPath: string): Promise<TrackingFileInspection>

  isWorktreeOfSameRepo(projectCwd: string, workdir: string): Promise<boolean>

  runVerifyCommand(args: RunVerifyArgs): Promise<RunVerifyResult>

  readOracleScript(workdirAbs: string, scriptPath: string): Promise<string | null>

  isLoopArmed(chatId: string): LoopState | null

  isChatBusy(chatId: string): boolean
}



export { clearClaudeSessionContext } from "./claude-context-commands"

export const MAX_CONSECUTIVE_LOOP_FAILURES = 3

const ARM_VERIFY_TIMEOUT_MS = 300_000

export async function disarmFailingLoop(
  deps: LoopCommandDeps,
  chatId: string,
  runId: string,
  failures: number,
  notification: string,
): Promise<void> {
  try {
    const now = Date.now()
    const armed = isLoopArmed(deps, chatId)
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_disarmed",
      timestamp: now,
      chatId,
      scheduleId: crypto.randomUUID(),
      reason: "repeated_failures",
    })
    await deps.store.appendMessage(chatId, timestamped({
      kind: "loop_disarmed",
      reason: "repeated_failures",
      resumable: true,
      ...(armed?.trackingFileRel ? { trackingFileRel: armed.trackingFileRel } : {}),
      ...(armed?.workdirAbs ? { workdirAbs: armed.workdirAbs } : {}),
    }))
    await clearClaudeSessionContext(deps, chatId)
    await deps.store.appendMessage(chatId, timestamped({ kind: "context_cleared" }))
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: now,
      chatId,
      scheduleId: crypto.randomUUID(),
      scheduledAt: now,
      tz: "system",
      source: "subagent_background",
      resetAt: now,
      detectedAt: now,
      prompt:
        `${notification}\n\nThe loop has been DISARMED automatically after ${failures}`
        + " consecutive failed iterations. Do not re-arm it blindly: report the failure"
        + " reason above to the user and say what needs fixing first.",
    })
  } catch (err) {
    log.warn(`[kanna] disarmFailingLoop failed`, { chatId, runId, err })
  }
}

export async function deliverSubagentToMain(
  deps: LoopCommandDeps,
  chatId: string,
  runId: string,
  outcome: BackgroundRunOutcome,
): Promise<void> {
  if (!deps.store.getChat(chatId)) return
  return withSpan(
    "kanna.loop.wake.deliver",
    { "kanna.chat_id": chatId, "kanna.run_id": runId, "kanna.outcome": outcome.status },
    () => deliverSubagentToMainInner(deps, chatId, runId, outcome),
  )
}

function describeLastPlan(spec: LoopSpec | null): string {
  const file = spec?.trackingFileRel
  if (!file) return ""
  if (!spec.workdirAbs) return ` This chat's most recent loop tracked its plan in ${file}.`
  return ` This chat's most recent loop tracked its plan at`
    + ` ${spec.workdirAbs.replace(/\/+$/, "")}/${file} — read that exact path,`
    + ` which may be a different checkout from this chat's working directory.`
}

async function deliverSubagentToMainInner(
  deps: LoopCommandDeps,
  chatId: string,
  runId: string,
  outcome: BackgroundRunOutcome,
): Promise<void> {

  const armed = isLoopArmed(deps, chatId)
  const notification = buildTaskNotification(runId, outcome, { includeResult: !armed })

  let failuresAfterThisRun = 0
  if (armed) {
    const ok = outcome.status === "completed"
    failuresAfterThisRun = ok ? 0 : armed.consecutiveFailures + 1
    try {
      await deps.emitAutoContinueEvent({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "loop_run_outcome",
        timestamp: Date.now(),
        chatId,
        scheduleId: crypto.randomUUID(),
        ok,
        errorCode: outcome.status === "failed" ? outcome.errorCode : undefined,
      })
    } catch (err) {
      log.warn(`[kanna] loop_run_outcome emit failed`, { chatId, runId, err })
    }
  }

  if (armed && failuresAfterThisRun >= MAX_CONSECUTIVE_LOOP_FAILURES) {
    await disarmFailingLoop(deps, chatId, runId, failuresAfterThisRun, notification)
    return
  }

  let prompt: string
  if (armed) {
    prompt = `${notification}\n\n${armed.prompt}`
  } else {
    const plan = describeLastPlan(
      deriveLastLoopSpec(deps.store.getAutoContinueEvents(chatId), chatId),
    )
    const next = outcome.status === "completed"
      ? "decide the next action."
      : "decide whether to retry, try another approach, or stop."
    prompt = `${notification}\n\nYour Claude context has been cleared.${plan} Then ${next}`
  }

  try {
    await clearClaudeSessionContext(deps, chatId)
    await deps.store.appendMessage(chatId, timestamped({ kind: "context_cleared" }))

    const now = Date.now()
    const scheduleId = crypto.randomUUID()
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: now,
      chatId,
      scheduleId,
      scheduledAt: now,
      tz: "system",
      source: "subagent_background",
      resetAt: now,
      detectedAt: now,
      prompt,
    })
  } catch (err) {
    log.warn(`[kanna] deliverSubagentToMain failed`, { chatId, runId, err })
  }
}

export async function setupLoop(
  deps: LoopCommandDeps,
  args: {
    chatId: string
    input: LoopSetupInput
  },
): Promise<SetupLoopHandlerResult> {
  const chat = deps.store.getChat(args.chatId)
  if (!chat) return { ok: false, errors: [`chat ${args.chatId} not found`] }
  const project = deps.store.getProject(chat.projectId)
  if (!project) return { ok: false, errors: [`project ${chat.projectId} not found`] }

  const chatCwd = resolveSpawnPaths(chat, project.localPath).cwd

  const validation = validateLoopSetup(args.input, chatCwd, {
    roster: deps.getSubagents().map((s) => ({ id: s.id, name: s.name, triggerMode: s.triggerMode })),
    defaultLoopSubagentId: deps.getAppSettingsSnapshot().subagentRuntime?.defaultLoopSubagentId ?? null,
  })
  if (!validation.ok) return { ok: false, errors: validation.errors }

  const resolved = validation.resolved

  if (resolved.workdirAbs !== chatCwd) {
    const sameRepo = await deps.isWorktreeOfSameRepo(project.localPath, resolved.workdirAbs)
    if (!sameRepo) {
      return {
        ok: false,
        errors: [
          `workdir ${resolved.workdirAbs} is not this project's checkout or a git worktree of it`,
        ],
      }
    }
  }

  const inspection = await deps.inspectTrackingFile(resolved.trackingFileAbs)
  if (inspection.content !== null) {
    const safety = assertTrackingFileSafe(inspection.content, {
      goal: resolved.goal,
      gitTracked: inspection.gitTracked,
      force: args.input.force === true,
    })
    if (!safety.ok) return { ok: false, errors: [safety.error] }
  }

  const armCheck = await deps.runVerifyCommand({
    command: resolved.verifyCommand,
    cwd: resolved.workdirAbs,
    timeoutMs: ARM_VERIFY_TIMEOUT_MS,
  })
  if (armCheck.exitCode === 0 && args.input.force !== true) {
    return {
      ok: false,
      errors: [
        "the verify command already exits 0, so the loop would declare GOAL MET on its"
        + " first iteration without doing any work. Either the goal is already met, or"
        + " the oracle is too weak to define it — tighten the command (prefer a test in"
        + " the repo over a grep), or pass force: true if this is intentional.",
      ],
    }
  }

  const scriptPath = extractOracleScriptPath(resolved.verifyCommand)
  const scriptContent = scriptPath === null
    ? null
    : await deps.readOracleScript(resolved.workdirAbs, scriptPath)
  const oracleWarnings = auditOracle({
    verifyCommand: resolved.verifyCommand,
    scriptPath,
    scriptContent,
  })
  let created: boolean
  let reconciled: boolean
  let reconcileActions: string[]
  try {
    const ensureResult = await deps.ensureTrackingFile({
      absPath: resolved.trackingFileAbs,
      skeleton: resolved.skeleton,
      reconcile: (existing) =>
        reconcileTrackingFile(existing, {
          goal: resolved.goal,
          verifyCommand: resolved.verifyCommand,
          chunkHint: resolved.chunkHint,
        }),
    })
    created = ensureResult.created
    reconciled = ensureResult.reconciled
    reconcileActions = ensureResult.actions
  } catch (err) {
    return {
      ok: false,
      errors: [`ensureTrackingFile failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  try {
    await clearClaudeSessionContext(deps, args.chatId)
    await deps.store.appendMessage(args.chatId, timestamped({ kind: "context_cleared" }))

    const now = Date.now()
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_armed",
      timestamp: now,
      chatId: args.chatId,
      scheduleId: crypto.randomUUID(),
      subagentId: resolved.subagentId,
      prompt: resolved.prompt,
      verifyCommand: resolved.verifyCommand,
      workdirAbs: resolved.workdirAbs,
      trackingFileRel: resolved.trackingFileRel,
    })

    const scheduleId = crypto.randomUUID()
    await deps.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: now,
      chatId: args.chatId,
      scheduleId,
      scheduledAt: now,
      tz: "system",
      source: "subagent_background",
      resetAt: now,
      detectedAt: now,
      prompt: resolved.prompt,
    })
  } catch (err) {
    return {
      ok: false,
      errors: [`enqueue failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  return {
    ok: true,
    trackingFileRel: resolved.trackingFileRel,
    created,
    reconciled,
    reconcileActions,
    oracleWarnings,
    prompt: resolved.prompt,
  }
}

export function isLoopArmed(deps: LoopCommandDeps, chatId: string): LoopState | null {
  return deriveLoopState(deps.store.getAutoContinueEvents(chatId), chatId)
}

export function toArmedLoopInfo(state: LoopState | null): ArmedLoopInfo | null {
  if (!state) return null
  return {
    verifyCommand: state.verifyCommand,
    workdirAbs: state.workdirAbs,
    trackingFileRel: state.trackingFileRel,
  }
}

export async function stopLoop(
  deps: LoopCommandDeps,
  chatId: string,
  reason: "goal_met" | "user_send" | "chat_deleted",
): Promise<void> {
  const armed = isLoopArmed(deps, chatId)
  if (!armed) return
  await deps.emitAutoContinueEvent({
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "loop_disarmed",
    timestamp: Date.now(),
    chatId,
    scheduleId: crypto.randomUUID(),
    reason,
  })

  if (reason === "chat_deleted") return
  try {
    await deps.store.appendMessage(chatId, timestamped({
      kind: "loop_disarmed",
      reason,
      resumable: true,
      ...(armed.trackingFileRel !== null ? { trackingFileRel: armed.trackingFileRel } : {}),
      ...(armed.workdirAbs !== null ? { workdirAbs: armed.workdirAbs } : {}),
    }))
  } catch (err) {
    log.warn("[kanna] loop_disarmed card append failed", { chatId, err })
  }
}

export function listLiveSchedules(deps: LoopCommandDeps, chatId: string): string[] {
  const { schedules } = deriveChatSchedules(deps.store.getAutoContinueEvents(chatId), chatId)
  return Object.values(schedules)
    .filter((s) => s.state === "proposed" || s.state === "scheduled")
    .map((s) => s.scheduleId)
    .sort()
}
