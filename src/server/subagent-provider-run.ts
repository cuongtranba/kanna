import type { HarnessEvent, HarnessToolRequest, HarnessTurn } from "./harness-types"
import type { CodexAppServerManager } from "./codex-app-server"
import type {
  AgentProvider,
  ProviderUsage,
  ResolvedStackBinding,
  Subagent,
  TranscriptEntry,
} from "../shared/types"
import { renderStackProjectsBlock } from "../shared/kanna-system-prompt"
import type { ClaudeSessionHandle } from "./agent"
import type { LiveTurnSource, ProviderRunStart } from "./subagent-orchestrator"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { KannaMcpDelegationContext } from "./kanna-mcp"
import { log } from "../shared/log"

/**
 * Builds a ProviderRunStart for a single subagent run. Each call returns a
 * fresh ProviderRunStart bound to one (subagent, chatId) pair — the orchestrator
 * invokes start() exactly once per run, then discards.
 */
export interface BuildSubagentProviderRunArgs {
  subagent: Subagent
  chatId: string
  primer: string | null
  /**
   * The instruction that triggered this run — the user's typed message when
   * spawned from a `@agent/<name>` mention, the parent agent's reply text for
   * chained mentions, or null when no instruction is available (e.g. a
   * background trigger). Always rendered above the primer so the subagent
   * sees the request before the context.
   */
  userInstruction: string | null
  runId: string
  /** Abort signal from the run's AbortController; triggers cancellation of the provider session. */
  abortSignal: AbortSignal
  /** Project cwd shared with the parent chat — overridden when subagent declares workingDir. */
  cwd: string
  additionalDirectories?: string[]
  /**
   * Resolved allowed filesystem roots when the subagent declares
   * workingDir / allowedPaths. When set, the spawn must force shim-only tool
   * mode (disallow native FS tools, allowlist mcp__kanna__*) and the kanna-mcp
   * host registers a per-run path-deny scope keyed on runId. Undefined =
   * no restriction (legacy behaviour).
   */
  allowedPaths?: string[]
  /**
   * Subset of `AgentCoordinatorArgs["startClaudeSession"]` (`agent.ts:148-172`).
   * Subagents intentionally omit `tunnelGateway` — they don't tunnel-route.
   * Structural typing accepts the canonical fn (which has the extra optional
   * field) since the missing prop is optional from the canonical side.
   */
  startClaudeSession: (args: {
    projectId: string
    localPath: string
    model: string
    effort?: string
    planMode: boolean
    sessionToken: string | null
    forkSession: boolean
    oauthToken: string | null
    additionalDirectories?: string[]
    chatId?: string
    onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
    systemPromptOverride?: string
    initialPrompt?: string
    subagentOrchestrator?: SubagentOrchestrator
    delegationContext?: KannaMcpDelegationContext
    restrictedAllowedPaths?: string[]
    keepAlive?: boolean
  }) => Promise<ClaudeSessionHandle>
  /** Optional — propagated into the subagent's own kanna-mcp so it can call `delegate_subagent`. */
  subagentOrchestrator?: SubagentOrchestrator
  /** Optional — per-spawn delegation context forwarded to kanna-mcp for sub-spawn-sub. */
  delegationContext?: KannaMcpDelegationContext
  codexManager: CodexAppServerManager
  /** Forwards interactive tool requests (AskUserQuestion / ExitPlanMode) to the parent chat's UI handler. */
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
  /** Resolves credentials per provider. Returns false → run fails AUTH_REQUIRED. */
  authReady: (provider: AgentProvider) => Promise<boolean>
  /** Picks an oauth token for Claude runs, or null. Subagents share the primary pool. */
  pickOauthToken: () => string | null
  projectId: string
  /**
   * Optional user-authored global instructions (from app settings).
   * Appended to the subagent's own `systemPrompt` for Claude runs and sent as
   * `developer_instructions` for Codex runs so subagent turns inherit the
   * same project-wide guidance as the main turn.
   */
  globalPromptAppend?: string
  /**
   * Resolved stack bindings when the parent chat spans multiple projects AND
   * this subagent run is unrestricted (no workingDir / allowedPaths). Rendered
   * as a `## Stack projects` block in the Claude subagent system prompt so a
   * delegated run that inherits every stack root (via additionalDirectories)
   * also knows which project each path is. Empty for solo chats or
   * path-restricted runs (where listing all roots would mislead).
   */
  stackProjects?: ResolvedStackBinding[]
}

export function buildSubagentProviderRun(args: BuildSubagentProviderRunArgs): ProviderRunStart {
  return {
    provider: args.subagent.provider,
    model: args.subagent.model,
    systemPrompt: args.subagent.systemPrompt,
    preamble: args.primer,
    authReady: async () => args.authReady(args.subagent.provider),
    async start(onChunk, onEntry, opts) {
      const initialPrompt = composeInitialPrompt(args.subagent, args.primer, args.userInstruction)
      const keepAlive = Boolean(opts?.keepAlive) && args.subagent.provider === "claude"
      if (args.subagent.provider === "claude") {
        return runClaudeSubagent({ args, initialPrompt, onChunk, onEntry, keepAlive })
      }
      return runCodexSubagent({ args, initialPrompt, onChunk, onEntry })
    },
  }
}

/**
 * Build the Claude subagent's `systemPromptOverride`. Subagent prompts replace
 * the kanna system prompt entirely (the Claude SDK has no `append` channel for
 * an override), so the global instructions must be folded in here to keep
 * subagent turns aligned with main-turn behavior.
 */
export function composeSubagentSystemPrompt(
  subagentSystemPrompt: string,
  globalPromptAppend?: string,
  stackProjects: ResolvedStackBinding[] = [],
): string {
  const extra = globalPromptAppend?.trim() ?? ""
  const stackBlock = renderStackProjectsBlock(stackProjects)
  const sections = [subagentSystemPrompt.trimEnd()]
  if (extra) sections.push(`## Project instructions\n\n${extra}`)
  if (stackBlock) sections.push(stackBlock)
  return sections.filter((s) => s !== "").join("\n\n")
}

export function composeInitialPrompt(
  subagent: Subagent,
  primer: string | null,
  userInstruction: string | null,
): string {
  const instruction = userInstruction?.trim() ?? ""
  const primerText = primer?.trim() ?? ""
  if (instruction && primerText) {
    return `User asked: ${instruction}\n\n${primerText}`
  }
  if (instruction) return `User asked: ${instruction}`
  if (primerText) return primerText
  return `(no prior context — proceed based on your system prompt and the @agent/${subagent.name} mention)`
}

async function runClaudeSubagent(opts: {
  args: BuildSubagentProviderRunArgs
  initialPrompt: string
  onChunk: (chunk: string) => void
  onEntry: (entry: TranscriptEntry) => void
  keepAlive: boolean
}): Promise<{ text: string; usage?: ProviderUsage; live?: LiveTurnSource }> {
  const { args, initialPrompt, onChunk, onEntry, keepAlive } = opts
  // Fresh Claude session per subagent (sessionToken: null, forkSession: false)
  // — main-agent context never leaks in. Combined with the main-agent /clear
  // that fires on every subagent_background delivery in
  // AgentCoordinator.deliverSubagentToMain, this makes PROGRESS.md the ONLY
  // durability contract for the loop-orchestration pattern. See
  // adr-2026XXXX-notification-driven-loop-orchestration.
  const session = await args.startClaudeSession({
    projectId: args.projectId,
    localPath: args.cwd,
    additionalDirectories: args.additionalDirectories,
    model: args.subagent.model,
    effort: args.subagent.modelOptions?.reasoningEffort,
    planMode: false,
    sessionToken: null,
    forkSession: false,
    oauthToken: args.pickOauthToken(),
    chatId: args.chatId,
    onToolRequest: args.onToolRequest,
    systemPromptOverride: composeSubagentSystemPrompt(args.subagent.systemPrompt, args.globalPromptAppend, args.stackProjects),
    initialPrompt,
    subagentOrchestrator: args.subagentOrchestrator,
    delegationContext: args.delegationContext,
    restrictedAllowedPaths: args.allowedPaths,
    keepAlive,
  })
  args.abortSignal.addEventListener("abort", () => { session.interrupt() }, { once: true })

  if (!keepAlive) {
    // One-shot path: drain fully and always close.
    try {
      return await drainHarnessTurn(session, onChunk, onEntry)
    } finally {
      session.close()
    }
  }

  // Keep-alive path: drain turn 1, leave iterator open, build LiveTurnSource.
  const iterator = session.stream[Symbol.asyncIterator]()
  let first: { text: string; usage?: ProviderUsage; sawResult: boolean; sawError: boolean }
  try {
    first = await drainOneTurn(iterator, onChunk, onEntry)
  } catch (err) {
    session.close()
    throw err
  }

  if (!session.pushChannelPrompt) {
    session.close()
    throw new Error(
      "keep-alive requires channel delivery (pushChannelPrompt missing) — cannot drive turn 2+",
    )
  }

  const pushChannelPrompt = session.pushChannelPrompt

  const live: LiveTurnSource = {
    async runTurn(prompt, oc, oe) {
      await pushChannelPrompt(prompt)
      const result = await drainOneTurn(iterator, oc, oe)
      return { text: result.text, usage: result.usage }
    },
    async close() {
      try { session.close() } catch { /* ignore */ }
    },
  }

  return { text: first.text, usage: first.usage, live }
}

async function runCodexSubagent(opts: {
  args: BuildSubagentProviderRunArgs
  initialPrompt: string
  onChunk: (chunk: string) => void
  onEntry: (entry: TranscriptEntry) => void
}): Promise<{ text: string; usage?: ProviderUsage }> {
  const { args, initialPrompt, onChunk, onEntry } = opts
  const scope = `sub:${args.runId}` as const
  args.abortSignal.addEventListener("abort", () => { args.codexManager.stopSession(args.chatId, scope) }, { once: true })
  await args.codexManager.startSession({
    chatId: args.chatId,
    scope,
    cwd: args.cwd,
    model: args.subagent.model,
    serviceTier: undefined,
    sessionToken: null,
  })
  try {
    const turn = await args.codexManager.startTurn({
      chatId: args.chatId,
      scope,
      content: initialPrompt,
      model: args.subagent.model,
      effort: args.subagent.modelOptions && "fastMode" in args.subagent.modelOptions
        ? args.subagent.modelOptions.reasoningEffort
        : undefined,
      serviceTier: undefined,
      planMode: false,
      onToolRequest: args.onToolRequest,
      developerInstructions: args.globalPromptAppend,
    })
    return await drainHarnessTurn(turn, onChunk, onEntry)
  } finally {
    args.codexManager.stopSession(args.chatId, scope)
  }
}

/**
 * Drain exactly ONE turn from a persistent async iterator, stopping at the
 * first `result` entry. The iterator is left open so callers can resume on
 * the next turn (multi-turn keep-alive). For one-shot drains the driver
 * closes the stream right after the result, so the early-break is equivalent.
 *
 * Exported so multi-turn callers can drain turns independently over a shared
 * iterator without consuming the whole stream.
 */
export async function drainOneTurn(
  iterator: AsyncIterator<HarnessEvent>,
  onChunk: (chunk: string) => void,
  onEntry: (entry: TranscriptEntry) => void,
): Promise<{ text: string; usage?: ProviderUsage; sawResult: boolean; sawError: boolean }> {
  let accumulated = ""
  let usage: ProviderUsage | undefined
  let sawResult = false
  let sawError = false
  while (true) {
    const next = await iterator.next()
    if (next.done) break
    const event = next.value
    if (event.type !== "transcript" || !event.entry) continue
    onEntry(event.entry)
    if (event.entry.kind === "assistant_text") {
      const fragment = event.entry.text
      accumulated += fragment
      onChunk(fragment)
    } else if (event.entry.kind === "api_error") {
      sawError = true
    } else if (event.entry.kind === "result") {
      const e = event.entry
      sawResult = true
      if (e.isError) sawError = true
      usage = {
        inputTokens: e.usage?.inputTokens,
        outputTokens: e.usage?.outputTokens,
        cachedInputTokens: e.usage?.cachedInputTokens,
        costUsd: e.costUsd,
      }
      break // stop at end of THIS turn; leave iterator open for next turn
    }
  }
  return { text: accumulated, usage, sawResult, sawError }
}

async function drainHarnessTurn(
  turn: HarnessTurn,
  onChunk: (chunk: string) => void,
  onEntry: (entry: TranscriptEntry) => void,
): Promise<{ text: string; usage?: ProviderUsage }> {
  const iterator = turn.stream[Symbol.asyncIterator]()
  const { text, usage, sawResult, sawError } = await drainOneTurn(iterator, onChunk, onEntry)
  // Log how the drain ended so post-mortem investigation can distinguish:
  //   • clean completion (sawResult + no error)
  //   • PTY exit synth error (sawResult + isError) — process died mid-turn
  //   • premature stream close (no result at all) — orchestrator close or
  //     driver bug; partial text is the only evidence
  log.info("[kanna/subagent] drainHarnessTurn finished", {
    accumulatedChars: text.length,
    sawResult,
    sawError,
    hasUsage: Boolean(usage),
  })
  return { text, usage }
}
