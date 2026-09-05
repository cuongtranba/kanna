import type { JsonValue } from "../../shared/json"
import { homedir } from "node:os"
import path from "node:path"
import { log } from "../../shared/log"
import { randomUUID } from "node:crypto"
import { createRuntimeDir, writeRuntimeFile, removeRuntimeDir } from "./runtime-dir.adapter"
import { verifyPtyAuth } from "./auth"
import { buildPtyEnv } from "./env"
import { withAdditionalDirectoryMemory } from "../claude-spawn-helpers"
import { startKannaMcpHttpServer, buildMcpConfigJson, type KannaMcpHttpHandle } from "../kanna-mcp-http"
import { KANNA_MCP_SERVER_NAME } from "../../shared/tools"
import type { ArmedLoopInfo, KannaMcpDelegationContext, SetupLoopHandlerResult } from "../kanna-mcp"
import type { BoardRegistry } from "../board-registry"
import type { LoopSetupInput } from "../loop-template"
import type { SubagentOrchestrator } from "../subagent-orchestrator"
import { parseConfiguredContextWindowFromModelId, timestamped } from "../agent"
import { KANNA_SYSTEM_PROMPT_APPEND } from "../../shared/kanna-system-prompt"
import { resolveClaudeBinary } from "./resolve-binary.adapter"
import { createJsonlEventParser } from "./jsonl-to-event"
import { OutputRing, OUTPUT_RING_DEFAULT_BYTES } from "./output-ring"
import { createSmokeTestGate, createFileSmokeTestCache, buildLiveSmokeProbe, type SmokeTestGate } from "./smoke-test"
import { computeBinarySha256 } from "./preflight/binary-fingerprint.adapter"
import { spawnPtyProcess as defaultSpawnPtyProcess, type PtyProcess, type SpawnPtyProcessArgs } from "./pty-process.adapter"
import type { ClaudePtyRegistry } from "./pid-registry.adapter"
import type { PtyInstanceRegistry } from "./pty-instance-registry"
import { sampleProcessTreeUsage as defaultSampleProcessTreeUsage, type ProcessTreeSample } from "./pty-memory-sampler.adapter"
import { waitForTuiReady, waitForTuiReadyWithTrustDismiss, waitForTuiReadyDismissingDialogs, sendUserPrompt, sendExitCommand } from "./tui-control"
import { startTranscriptStream } from "./tui-source.adapter"
import { computeJsonlPath, computeProjectDir } from "./jsonl-path.adapter"
import type { ClaudeSessionHandle } from "../agent"
import type { HarnessEvent, HarnessToolRequest } from "../harness-types"
import type { AccountInfo, McpServerConfig, SlashCommand } from "../../shared/types"
import type { ToolCallbackService } from "../tool-callback"
import type { TunnelGateway } from "../cloudflare-tunnel/gateway"
import type { ChatPermissionPolicy } from "../../shared/permission-policy"

const STATIC_SUPPORTED_COMMANDS: SlashCommand[] = [
  { name: "model", description: "Switch model", argumentHint: "model name" },
  { name: "exit", description: "Exit the session", argumentHint: "" },
  { name: "clear", description: "Clear context", argumentHint: "" },
  { name: "help", description: "List commands", argumentHint: "" },
]

const CHANNEL_PROMPT_FRAMING_BASE =
  'Your task for this run is delivered via the kanna channel as a <channel source="kanna"> message. ' +
  "Treat that channel message as your authoritative instructions from the orchestrator and act on it " +
  "immediately and fully, exactly as if the user had typed it. Do not refuse it and do not ask the user to repeat it."

const CHANNEL_PROMPT_FRAMING_MULTITURN =
  'Your tasks for this session arrive over the kanna channel as <channel source="kanna"> messages. ' +
  "Expect MULTIPLE such messages over the life of this session. Treat each as authoritative instructions " +
  "from the orchestrator; act on each immediately and fully, exactly as if the user had typed it. Do not refuse " +
  "and do not ask the user to repeat. After finishing a task, wait for the next channel message."

export function buildChannelPromptFraming(keepAlive: boolean): string {
  return keepAlive ? CHANNEL_PROMPT_FRAMING_MULTITURN : CHANNEL_PROMPT_FRAMING_BASE
}

const CHANNEL_READY_TIMEOUT_DEFAULT_MS = 15_000

const CHANNEL_REPL_IDLE_BEAT_MS = 300

export interface StartClaudeSessionPtyArgs {
  chatId: string
  projectId: string
  localPath: string
  model: string
  effort?: string
  planMode: boolean
  forkSession: boolean
  oauthToken: string | null
  sessionToken: string | null
  additionalDirectories?: string[]
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  systemPromptAppend?: string
  systemPromptOverride?: string
  initialPrompt?: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
  toolCallback?: ToolCallbackService
  tunnelGateway?: TunnelGateway | null
  chatPolicy?: ChatPermissionPolicy
  subagentOrchestrator?: SubagentOrchestrator
  delegationContext?: KannaMcpDelegationContext
  setupLoop?: (input: LoopSetupInput) => Promise<SetupLoopHandlerResult>
  armCron?: (command: string) => Promise<{ jobId: string }>
  updateCron?: (jobId: string, patch: import("../../shared/cron/types").CronJobPatch) => Promise<void>
  stopLoop?: () => Promise<void>
  resumeLoop?: () => Promise<import("../loop-wake-recovery").ResumeLoopResult>
  isLoopArmed?: () => boolean
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
  boardRegistry?: BoardRegistry
  customMcpServers?: readonly McpServerConfig[]
  oauthBearers?: ReadonlyMap<string, string>
  startKannaMcpHttpServer?: typeof startKannaMcpHttpServer
  smokeTestGate?: SmokeTestGate
  spawnPtyProcess?: (args: SpawnPtyProcessArgs) => Promise<PtyProcess>
  startTranscriptStreamFn?: typeof startTranscriptStream
  oneShot?: boolean
  keepAlive?: boolean
  maxTurns?: number
  oauthLabel?: string
  oauthKeyMasked?: string
  ptyRegistry?: ClaudePtyRegistry
  ptyInstanceRegistry?: PtyInstanceRegistry
  workflowRegistry?: import("../workflow-registry").WorkflowRegistry
  subagentTranscriptRegistry?: import("../subagent-transcript-registry").SubagentTranscriptRegistry
  sampleProcessTreeUsage?: (pid: number) => Promise<ProcessTreeSample | null>
  memorySamplerIntervalMs?: number
  restrictedAllowedPaths?: string[]
}

export const RESTRICTED_FS_NATIVE_TOOLS = [
  "Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch",
] as const

export function deriveAccountInfoFromOauth(args: { label?: string; oauthKeyMasked?: string }): AccountInfo | null {
  const hasLabel = Boolean(args.label && args.label.length > 0)
  const hasMasked = Boolean(args.oauthKeyMasked && args.oauthKeyMasked.length > 0)
  if (!hasLabel && !hasMasked) return null
  const info: AccountInfo = { tokenSource: "kanna-oauth-pool" }
  if (hasLabel) info.organization = args.label
  if (hasMasked) info.oauthKeyMasked = args.oauthKeyMasked
  return info
}

export const SHIFT_TAB_KEY = "\x1b[Z"

export const PLAN_MODE_EXIT_UNSUPPORTED =
  "[claude-pty] cannot exit plan mode: driver-tracked plan mode is inactive "
  + "(plan mode may have been toggled externally via Shift+Tab). "
  + "Restart the session to return to acceptEdits."

export const PTY_STDERR_RING_BYTES = OUTPUT_RING_DEFAULT_BYTES
export { OutputRing }

export const PTY_DISALLOWED_NATIVE_TOOLS = ["AskUserQuestion", "ExitPlanMode", "ScheduleWakeup"] as const

export interface BuildPtyCliArgsInput {
  sessionId: string
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  additionalDirectories?: string[]
  systemPromptOverride?: string
  systemPromptAppend?: string
  mcpConfigPath?: string
  channelServerName?: string
  restricted?: boolean
  loopArmed?: boolean
}

export const PTY_LOOP_BLOCKED_NATIVE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Task"] as const

export function buildPtyCliArgs(args: BuildPtyCliArgsInput): string[] {
  const cliArgs: string[] = [
    "--model", args.model,
    "--setting-sources", "user,project,local",
    "--permission-mode", args.planMode ? "plan" : "acceptEdits",
    "--dangerously-skip-permissions",
  ]
  if (args.sessionToken && !args.forkSession) {
    cliArgs.push("--resume", args.sessionToken)
  } else if (args.sessionToken && args.forkSession) {
    cliArgs.push("--session-id", args.sessionId, "--resume", args.sessionToken, "--fork-session")
  }
  if (args.mcpConfigPath) {
    cliArgs.push("--mcp-config", args.mcpConfigPath, "--strict-mcp-config")
  }
  if (args.effort && args.effort.length > 0) cliArgs.push("--effort", args.effort)
  if (args.additionalDirectories) {
    for (const dir of args.additionalDirectories) cliArgs.push("--add-dir", dir)
  }
  if (args.systemPromptOverride) {
    cliArgs.push("--system-prompt", args.systemPromptOverride)
  } else {
    cliArgs.push("--append-system-prompt", args.systemPromptAppend ?? KANNA_SYSTEM_PROMPT_APPEND)
  }
  if (args.channelServerName) {
    cliArgs.push(
      "--dangerously-load-development-channels",
      `server:${args.channelServerName}`,
    )
  }
  if (args.restricted) {
    cliArgs.push("--tools", "mcp__kanna__*")
  }
  const disallow: string[] = args.restricted
    ? [...PTY_DISALLOWED_NATIVE_TOOLS, ...RESTRICTED_FS_NATIVE_TOOLS]
    : [...PTY_DISALLOWED_NATIVE_TOOLS]
  if (args.loopArmed) {
    for (const t of PTY_LOOP_BLOCKED_NATIVE_TOOLS) {
      if (!disallow.includes(t)) disallow.push(t)
    }
  }
  cliArgs.push("--disallowedTools", ...disallow)
  return cliArgs
}

export function resolveSpawnSessionId(
  args: { sessionToken: string | null; forkSession: boolean },
  newId: () => string = randomUUID,
): string {
  if (args.forkSession) return newId()
  return args.sessionToken ?? newId()
}

export async function startClaudeSessionPTY(args: StartClaudeSessionPtyArgs): Promise<ClaudeSessionHandle> {
  const home = args.homeDir ?? homedir()
  const env = args.env ?? process.env

  log.info("[kanna/pty] startClaudeSessionPTY begin", {
    chatId: args.chatId,
    projectId: args.projectId,
    localPath: args.localPath,
    model: args.model,
    planMode: args.planMode,
    forkSession: args.forkSession,
    hasOauthToken: Boolean(args.oauthToken),
    oauthLabel: args.oauthLabel ?? null,
    sandboxEnvOverride: env.KANNA_PTY_SANDBOX ?? null,
    platform: process.platform,
    anthropicApiKeySet: Boolean(env.ANTHROPIC_API_KEY),
    claudeExecutable: env.CLAUDE_EXECUTABLE ?? null,
  })

  const spawnStartedAt = Date.now()
  args.ptyInstanceRegistry?.upsert(args.chatId, {
    cwd: args.localPath,
    model: args.model,
    accountLabel: args.oauthLabel ?? null,
    oauthMasked: args.oauthKeyMasked ?? null,
    phase: "spawning",
    startedAt: spawnStartedAt,
    lastEventAt: spawnStartedAt,
    planMode: args.planMode,
  })

  const auth = await verifyPtyAuth({ env, oauthToken: args.oauthToken })
  if (!auth.ok) {
    log.error("[kanna/pty] verifyPtyAuth failed", {
      chatId: args.chatId,
      error: auth.error,
      hasOauthToken: Boolean(args.oauthToken),
      anthropicApiKeySet: Boolean(env.ANTHROPIC_API_KEY),
    })
    throw new Error(auth.error)
  }

  const resolved = await resolveClaudeBinary({ env, homeDir: home })
  log.info("[kanna/pty] resolved claude binary", {
    chatId: args.chatId,
    path: resolved.path,
    source: resolved.source,
  })
  const claudeBinAbs = resolved.path

  const binarySha256 = await computeBinarySha256(claudeBinAbs)
  const smokeGate = args.smokeTestGate ?? createSmokeTestGate({
    probe: buildLiveSmokeProbe({
      claudeBinPath: claudeBinAbs,
      model: args.model,
      oauthToken: args.oauthToken ?? "",
      homeDir: home,
    }),
    cache: createFileSmokeTestCache({ cacheDir: path.join(home, ".kanna", "cache", "smoke-test") }),
    ttlMs: 24 * 3600 * 1000,
    now: () => Date.now(),
  })
  const smoke = await smokeGate.canSpawn({ binarySha256, model: args.model })
  if (!smoke.ok) {
    log.error("[kanna/pty] smoke-test refused spawn", { chatId: args.chatId, reason: smoke.reason })
    throw new Error(`PTY smoke-test refused spawn: ${smoke.reason}`)
  }

  const spawnEnv = withAdditionalDirectoryMemory(
    buildPtyEnv({
      baseEnv: env,
      homeDir: home,
      oauthToken: args.oauthToken,
    }),
    args.additionalDirectories,
  )

  const sessionId = resolveSpawnSessionId({
    sessionToken: args.sessionToken,
    forkSession: args.forkSession,
  })

  const runtimeDir = await createRuntimeDir(`kanna-pty-${sessionId.slice(0, 8)}-`)

  const mcpConfigPath = path.join(runtimeDir, "mcp-config.json")
  let mcpHandle: KannaMcpHttpHandle | undefined
  const startMcp = args.startKannaMcpHttpServer ?? startKannaMcpHttpServer
  try {
    mcpHandle = await startMcp({
      args: {
        projectId: args.projectId,
        localPath: args.localPath,
        chatId: args.chatId,
        sessionId,
        tunnelGateway: args.tunnelGateway ?? null,
        toolCallback: args.toolCallback,
        chatPolicy: args.chatPolicy,
        subagentOrchestrator: args.subagentOrchestrator,
        delegationContext: args.delegationContext,
        setupLoop: args.setupLoop,
        armCron: args.armCron,
        updateCron: args.updateCron,
        stopLoop: args.stopLoop,
        getArmedLoop: args.getArmedLoop,
        boardRegistry: args.boardRegistry,
        forceInteractiveToolCallbacks: true,
        restrictedAllowedPaths: args.restrictedAllowedPaths,
      },
    })
    await writeRuntimeFile(
      mcpConfigPath,
      buildMcpConfigJson(mcpHandle, args.customMcpServers ?? [], args.oauthBearers),
      { encoding: "utf8", mode: 0o600 },
    )
  } catch (err) {
    try { if (mcpHandle) await mcpHandle.close() } catch { }
    try { await removeRuntimeDir(runtimeDir) } catch { }
    throw err
  }

  const channelEnv = (args.env ?? process.env).KANNA_PTY_CHANNEL_DELIVERY ?? "enabled"
  const channelDeliveryEnabled =
    Boolean(args.oneShot) && Boolean(args.initialPrompt) && channelEnv !== "disabled"

  const effectiveSystemPromptOverride =
    channelDeliveryEnabled && args.systemPromptOverride
      ? `${args.systemPromptOverride}\n\n${buildChannelPromptFraming(Boolean(args.keepAlive))}`
      : args.systemPromptOverride

  const claudeBin = claudeBinAbs
  const cliArgs = buildPtyCliArgs({
    sessionId,
    model: args.model,
    effort: args.effort,
    planMode: args.planMode,
    sessionToken: args.sessionToken,
    forkSession: args.forkSession,
    additionalDirectories: args.additionalDirectories,
    systemPromptOverride: effectiveSystemPromptOverride,
    systemPromptAppend: args.systemPromptAppend,
    mcpConfigPath,
    channelServerName: channelDeliveryEnabled ? KANNA_MCP_SERVER_NAME : undefined,
    restricted: Boolean(args.restrictedAllowedPaths && args.restrictedAllowedPaths.length > 0),
    loopArmed: args.isLoopArmed?.() ?? false,
  })

  let closed = false
  let cleanedUp = false
  let ownPid: number | null = null
  let workflowRegistrationCancelled = false
  let cachedAccountInfo: AccountInfo | null = deriveAccountInfoFromOauth({ label: args.oauthLabel, oauthKeyMasked: args.oauthKeyMasked })
  let sawResultEntry = false
  let cachedSlashCommands: SlashCommand[] | null = null
  let localPlanModeActive = args.planMode
  const mergedQueue: HarnessEvent[] = []
  const mergedWaiters: Array<(r: IteratorResult<HarnessEvent>) => void> = []

  const { handleClosed, resolveHandleClosed } = makePtyClosedSignal()

  async function cleanupResources() {
    if (cleanedUp) return
    cleanedUp = true
    stopMemorySampler()
    if (ownPid !== null) {
      args.ptyInstanceRegistry?.markExitedIfCurrent(args.chatId, ownPid, {
        phase: "exited",
        exitedAt: Date.now(),
        lastEventAt: Date.now(),
      })
    }
    try { if (mcpHandle) await mcpHandle.close() } catch (err) {
      log.warn("[kanna/pty] mcpHandle.close failed (HTTP server may leak)", { chatId: args.chatId, sessionId, err })
    }
    try { await removeRuntimeDir(runtimeDir) } catch (err) {
      log.warn("[kanna/pty] runtimeDir cleanup failed", { chatId: args.chatId, runtimeDir, err })
    }
    if (args.ptyRegistry && ownPid !== null) {
      try { await args.ptyRegistry.unregister(ownPid) } catch (err) {
        log.warn("[kanna/pty] ptyRegistry.unregister failed", { chatId: args.chatId, sessionId, pid: ownPid, err })
      }
    }
    workflowRegistrationCancelled = true
    args.workflowRegistry?.unregister(args.chatId)
    args.subagentTranscriptRegistry?.unregister(args.chatId)
    resolveHandleClosed()
  }

  function pushMerged(ev: HarnessEvent) {
    if (ev.type === "transcript" && ev.entry) {
      const entry = ev.entry
      if (entry.kind === "account_info") {
        cachedAccountInfo = entry.accountInfo
      }
      if (entry.kind === "result") {
        sawResultEntry = true
      }
      if (entry.kind === "system_init" && Array.isArray(entry.slashCommands)) {
        cachedSlashCommands = entry.slashCommands.filter((s) => typeof s === "string").map((name) => ({
          name,
          description: "",
          argumentHint: "",
        }))
      }
    }
    const w = mergedWaiters.shift()
    if (w) w({ value: ev, done: false })
    else mergedQueue.push(ev)

    if (
      args.oneShot
      && !args.keepAlive
      && ev.type === "transcript"
      && ev.entry?.kind === "result"
    ) {
      void oneShotClose()
    }
  }

  let oneShotClosing = false
  let pty: PtyProcess

  let memorySamplerHandle: ReturnType<typeof setInterval> | null = null
  let rssPeakBytes = 0
  let cpuPeakPercent = 0

  function stopMemorySampler(): void {
    if (memorySamplerHandle !== null) {
      clearInterval(memorySamplerHandle)
      memorySamplerHandle = null
    }
  }

  function startMemorySampler(rootPid: number): void {
    if (memorySamplerHandle !== null) return
    const sampler = args.sampleProcessTreeUsage ?? defaultSampleProcessTreeUsage
    const intervalMs = args.memorySamplerIntervalMs ?? 2000
    const tick = async (): Promise<void> => {
      let sample: ProcessTreeSample | null
      try {
        sample = await sampler(rootPid)
      } catch {
        sample = null
      }
      if (sample === null) return
      if (sample.rssBytes > rssPeakBytes) rssPeakBytes = sample.rssBytes
      if (sample.cpuPercent > cpuPeakPercent) cpuPeakPercent = sample.cpuPercent
      args.ptyInstanceRegistry?.upsert(args.chatId, {
        rssBytes: sample.rssBytes,
        rssPeakBytes,
        cpuPercent: sample.cpuPercent,
        cpuPeakPercent,
      })
    }
    memorySamplerHandle = setInterval(() => { void tick() }, intervalMs)
    void tick()
  }

  const ring = new OutputRing()
  const spawnPty = args.spawnPtyProcess ?? defaultSpawnPtyProcess
  try {
    log.info("[kanna/pty] spawn begin", {
      chatId: args.chatId,
      command: claudeBin,
      cwd: args.localPath,
    })
    pty = await spawnPty({
      command: claudeBin,
      args: cliArgs,
      cwd: args.localPath,
      env: spawnEnv,
      onOutput: (chunk) => { ring.append(chunk) },
    })
    log.info("[kanna/pty] pty spawned", { chatId: args.chatId, sessionId, pid: pty.pid })
    ownPid = pty.pid
    args.ptyInstanceRegistry?.upsert(args.chatId, {
      sessionId,
      pid: pty.pid,
      phase: "trust-dialog",
      lastEventAt: Date.now(),
    })
    startMemorySampler(pty.pid)
    if (args.ptyRegistry) {
      try {
        await args.ptyRegistry.register({
          chatId: args.chatId,
          sessionId,
          pid: pty.pid,
          cwd: args.localPath,
          runtimeDir,
        })
      } catch (err) {
        log.warn("[kanna/pty] ptyRegistry.register failed (orphan reap on crash disabled for this session)", { chatId: args.chatId, sessionId, err })
      }
    }
  } catch (err) {
    log.error("[kanna/pty] spawn failed", {
      chatId: args.chatId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    try { await mcpHandle.close() } catch { }
    try { await removeRuntimeDir(runtimeDir) } catch { }
    throw err
  }

  const tuiReadyMs = Number((args.env ?? process.env).KANNA_PTY_TUI_BOOT_MS ?? 3000)
  const tuiReadyQuietRaw = (args.env ?? process.env).KANNA_PTY_TUI_READY_QUIET_MS
  const tuiReadyQuietMs = tuiReadyQuietRaw !== undefined ? Number(tuiReadyQuietRaw) : undefined
  const trustDismiss = (args.env ?? process.env).KANNA_PTY_TRUST_DISMISS ?? "enabled"
  const sessionEndGraceMs = Number((args.env ?? process.env).KANNA_PTY_SESSION_END_GRACE_MS ?? 5_000)
  if (channelDeliveryEnabled && trustDismiss !== "disabled") {
    const readyResult = await waitForTuiReadyDismissingDialogs(pty, ring, { hardCapMs: tuiReadyMs + 8_000 })
    if (readyResult === "timeout") {
      log.warn("[kanna/pty] TUI ready marker not detected after dialogs dismiss (channel path)", { chatId: args.chatId, hardCapMs: tuiReadyMs + 8_000 })
    } else {
      log.info("[kanna/pty] TUI ready (channel path)", { chatId: args.chatId })
    }
  } else if (trustDismiss !== "disabled") {
    const readyResult = await waitForTuiReadyWithTrustDismiss(pty, ring, { hardCapMs: tuiReadyMs + 5_000, quietPeriodMs: tuiReadyQuietMs })
    if (readyResult === "timeout") {
      log.warn("[kanna/pty] TUI ready marker not detected after trust dismiss", { chatId: args.chatId, hardCapMs: tuiReadyMs + 5_000 })
    } else {
      log.info("[kanna/pty] TUI ready", { chatId: args.chatId })
    }
  } else {
    const readyResult = await waitForTuiReady(ring, { hardCapMs: tuiReadyMs, quietPeriodMs: tuiReadyQuietMs })
    if (readyResult === "timeout") {
      log.warn("[kanna/pty] TUI ready marker not detected within hard cap", { chatId: args.chatId, hardCapMs: tuiReadyMs })
    }
  }

  args.ptyInstanceRegistry?.upsert(args.chatId, {
    phase: "ready",
    lastEventAt: Date.now(),
  })

  const projectDir = computeProjectDir({ homeDir: home, cwd: args.localPath })
  const knownFilePath = args.sessionToken && !args.forkSession
    ? computeJsonlPath({ homeDir: home, cwd: args.localPath, sessionId: args.sessionToken })
    : undefined
  const spawnStartedAtMs = Date.now()
  const startStream = args.startTranscriptStreamFn ?? startTranscriptStream
  const transcriptStream = await startStream({
    projectDir,
    knownFilePath,
    minMtimeMs: spawnStartedAtMs,
    claudeChildPid: pty.pid,
    homeDir: home,
  })

  if (args.workflowRegistry) {
    const registry = args.workflowRegistry
    const chatId = args.chatId
    void transcriptStream.filePath.then((filePath) => {
      const sessionUUID = path.basename(filePath, ".jsonl")
      const workflowsDir = path.join(projectDir, sessionUUID, "workflows")
      if (!workflowRegistrationCancelled) registry.register(chatId, workflowsDir)
    }).catch((err) => {
      log.warn("[kanna/pty] workflowRegistry.register skipped: transcript file not found", { chatId: args.chatId, err })
    })
  }

  if (args.subagentTranscriptRegistry) {
    const subRegistry = args.subagentTranscriptRegistry
    const chatId = args.chatId
    void transcriptStream.filePath.then((filePath) => {
      const sessionUUID = path.basename(filePath, ".jsonl")
      const subagentsDir = path.join(projectDir, sessionUUID, "subagents")
      if (!workflowRegistrationCancelled) subRegistry.register(chatId, subagentsDir)
    }).catch((err) => {
      log.warn("[kanna/pty] subagentTranscriptRegistry.register skipped: transcript file not found", { chatId: args.chatId, err })
    })
  }

  const parser = createJsonlEventParser({
    configuredContextWindow: parseConfiguredContextWindowFromModelId(args.model),
  })

  void (async () => {
    try {
      for await (const line of transcriptStream.lines) {
        try {
          const events = parser.parse(line)
          for (const ev of events) pushMerged(ev)
        } catch (err) {
          log.warn("[kanna/pty] parser threw on line", { chatId: args.chatId, sessionId, err })
        }
      }
      log.info("[kanna/pty] transcript stream ended", { chatId: args.chatId, sessionId })
    } catch (err) {
      log.warn("[kanna/pty] transcript stream errored", { chatId: args.chatId, sessionId, err })
    }
  })()

  function drainTerminate(exitCode: number | null) {
    log.info("[kanna/pty] drainTerminate", {
      chatId: args.chatId,
      sessionId,
      exitCode,
      closed,
      oneShotClosing,
      sawResultEntry,
      oneShot: Boolean(args.oneShot),
      waitersAwaitingEvent: mergedWaiters.length,
    })
    if (closed || oneShotClosing) {
      while (mergedWaiters.length > 0) {
        const w = mergedWaiters.shift()
        if (w) w({ value: undefined, done: true })
      }
      return
    }
    if (!sawResultEntry) {
      const tail = ring.tail().trim()
      const codeNote = exitCode === null ? "signal" : `exit code ${exitCode}`
      const resultText = tail.length > 0
        ? tail
        : `claude PTY process exited (${codeNote}) before producing a result.`
      log.warn("[kanna/pty] synthesizing error-result for early PTY exit (no turn_duration / result row seen)", {
        chatId: args.chatId,
        sessionId,
        exitCode,
        ringTailBytes: tail.length,
      })
      pushMerged({
        type: "transcript",
        entry: timestamped({
          kind: "result",
          subtype: "error" as const,
          isError: true,
          durationMs: 0,
          result: resultText,
          debugRaw: JSON.stringify({ source: "pty-exit", exitCode }),
        }),
      })
    }
    void cleanupResources()
    while (mergedWaiters.length > 0) {
      const w = mergedWaiters.shift()
      if (w) w({ value: undefined, done: true })
    }
  }

  void pty.exited
    .then((code) => {
      log.info("[kanna/pty] pty.exited resolved", { chatId: args.chatId, sessionId, pid: pty.pid, code })
      drainTerminate(typeof code === "number" ? code : null)
    })
    .catch((err) => {
      log.warn("[kanna/pty] pty.exited rejected", { chatId: args.chatId, sessionId, pid: pty.pid, err })
      drainTerminate(null)
    })

  async function oneShotClose() {
    if (oneShotClosing || closed) return
    oneShotClosing = true
    log.info("[kanna/pty] oneShotClose start", { chatId: args.chatId, sessionId, sawResultEntry })
    try { await sendExitCommand(pty) } catch (err) {
      log.warn("[kanna/pty] oneShotClose sendExitCommand failed", { chatId: args.chatId, sessionId, err })
    }
    try { await pty.exited } catch { }
    try { transcriptStream.close() } catch { }
    await cleanupResources()
    log.info("[kanna/pty] oneShotClose finished", { chatId: args.chatId, sessionId })
  }

  if (channelDeliveryEnabled && args.initialPrompt) {
    const readyTimeoutMs = Number(
      (args.env ?? process.env).KANNA_PTY_CHANNEL_READY_TIMEOUT_MS ?? CHANNEL_READY_TIMEOUT_DEFAULT_MS,
    )
    let channelReadyTimer: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        mcpHandle.channelClientReady,
        new Promise<never>((_, reject) => {
          channelReadyTimer = setTimeout(() => reject(new Error("channel client not ready")), readyTimeoutMs)
        }),
      ])
      if (channelReadyTimer !== null) { clearTimeout(channelReadyTimer); channelReadyTimer = null }
      await new Promise((r) => setTimeout(r, 300))
      await mcpHandle.pushChannelPrompt(args.initialPrompt)
      log.info("[kanna/pty] delivered initial prompt via channel push", { chatId: args.chatId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error("[kanna/pty] channel delivery failed; failing spawn (no paste fallback)", { chatId: args.chatId, sessionId, error: message })
      try { transcriptStream.close() } catch { }
      try { pty.close() } catch { }
      try { await mcpHandle.close() } catch { }
      try { await removeRuntimeDir(runtimeDir) } catch { }
      throw new Error(`PTY channel delivery failed: ${message}`, { cause: err })
    }
  } else if (args.initialPrompt) {
    try {
      await sendUserPrompt(pty, ring, args.initialPrompt)
    } catch (err) {
      log.warn("[kanna/pty] initialPrompt write failed", String(err))
    }
  }

  const stream: AsyncIterable<HarnessEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<HarnessEvent>> {
          if (mergedQueue.length > 0) {
            const ev = mergedQueue.shift()
            if (ev) return Promise.resolve({ value: ev, done: false })
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true })
          }
          return new Promise((resolve) => {
            mergedWaiters.push(resolve)
          })
        },
      }
    },
  }

  return {
    provider: "claude",
    stream,
    interrupt: async () => {
      try { await pty.sendInput("\x03") } catch { }
    },
    sendPrompt: async (content) => {
      const text = content
      const followupReadyMs = Number(
        (args.env ?? process.env).KANNA_PTY_FOLLOWUP_READY_MS ?? tuiReadyMs,
      )
      const ready = await waitForTuiReady(ring, {
        hardCapMs: followupReadyMs,
        quietPeriodMs: tuiReadyQuietMs,
      })
      if (ready === "timeout") {
        log.warn("[kanna/pty] TUI ready marker not detected before follow-up prompt; sending anyway", { chatId: args.chatId, hardCapMs: followupReadyMs })
      }
      await sendUserPrompt(pty, ring, text)
    },
    setModel: async (model) => {
      try {
        await pty.sendInput(`/model ${model}\r`)
      } catch (err) {
        log.warn("[kanna/pty] setModel via /model slash command failed", String(err))
      }
    },
    setPermissionMode: async (planMode) => {
      if (planMode) {
        try {
          await pty.sendInput("/plan\r")
          localPlanModeActive = true
        } catch (err) {
          log.warn("[kanna/pty] /plan slash command failed", String(err))
        }
        return
      }
      if (localPlanModeActive) {
        try {
          await pty.sendInput(SHIFT_TAB_KEY)
          localPlanModeActive = false
        } catch (err) {
          log.warn("[kanna/pty] Shift+Tab exit-plan failed", String(err))
        }
        return
      }
      log.warn(PLAN_MODE_EXIT_UNSUPPORTED)
    },
    getSupportedCommands: async () => cachedSlashCommands ?? STATIC_SUPPORTED_COMMANDS,
    getAccountInfo: async () => cachedAccountInfo,
    pushChannelPrompt: (channelDeliveryEnabled && args.keepAlive)
      ? async (text: string) => {
          await new Promise((r) => setTimeout(r, CHANNEL_REPL_IDLE_BEAT_MS))
          await mcpHandle.pushChannelPrompt(text)
        }
      : undefined,
    close: () => {
      if (closed) return
      closed = true
      void (async () => {
        try { await sendExitCommand(pty) } catch { }
        const sigkillTimer: { ref: ReturnType<typeof setTimeout> | null } = { ref: null }
        const termTimer = setTimeout(() => {
          try { pty.close() } catch { }
          sigkillTimer.ref = setTimeout(() => {
            try { pty.kill("SIGKILL") } catch { }
          }, 3000)
        }, sessionEndGraceMs)
        try {
          await pty.exited
        } catch { }
        clearTimeout(termTimer)
        if (sigkillTimer.ref !== null) clearTimeout(sigkillTimer.ref)
        try { transcriptStream.close() } catch { }
        await cleanupResources()
        while (mergedWaiters.length > 0) {
          const w = mergedWaiters.shift()
          if (w) w({ value: undefined, done: true })
        }
      })()
    },
    closed: handleClosed,
  }
}

function makePtyClosedSignal(): { handleClosed: Promise<void>; resolveHandleClosed: () => void } {
  let resolveHandleClosed!: () => void
  const handleClosed = new Promise<void>((resolve) => { resolveHandleClosed = resolve })
  return { handleClosed, resolveHandleClosed }
}
