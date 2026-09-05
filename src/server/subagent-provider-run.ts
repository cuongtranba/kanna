import type { JsonValue } from "../shared/json"
import type { HarnessEvent, HarnessToolRequest, HarnessTurn } from "./harness-types"
import type { CodexAppServerManager } from "./codex-app-server"
import type {
  AgentProvider,
  ProviderUsage,
  ResolvedStackBinding,
  Subagent,
  TranscriptEntry,
} from "../shared/types"
import {
  buildCodexDeveloperInstructions,
  renderInstructionSections,
  renderStackProjectsBlock,
  type KannaSystemPromptOptions,
} from "../shared/kanna-system-prompt"
import type { ClaudeSessionHandle } from "./agent"
import type { LiveTurnSource, ProviderRunStart } from "./subagent-orchestrator"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { ArmedLoopInfo, KannaMcpDelegationContext } from "./kanna-mcp"
import { log } from "../shared/log"

export interface BuildSubagentProviderRunArgs {
  subagent: Subagent
  chatId: string
  primer: string | null
  userInstruction: string | null
  runId: string
  abortSignal: AbortSignal
  cwd: string
  additionalDirectories?: string[]
  allowedPaths?: string[]
  startClaudeSession: (args: {
    projectId: string
    localPath: string
    model: string
    effort?: string
    planMode: boolean
    sessionToken: string | null
    forkSession: boolean
    oauthToken: string | null
    openrouterApiKey?: string | null
    additionalDirectories?: string[]
    chatId?: string
    onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
    systemPromptOverride?: string
    initialPrompt?: string
    subagentOrchestrator?: SubagentOrchestrator
    delegationContext?: KannaMcpDelegationContext
    restrictedAllowedPaths?: string[]
    keepAlive?: boolean
    maxTurns?: number
    getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
  }) => Promise<ClaudeSessionHandle>
  claudeDriverIsPty?: boolean
  subagentOrchestrator?: SubagentOrchestrator
  delegationContext?: KannaMcpDelegationContext
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
  codexManager: CodexAppServerManager
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  authReady: (provider: AgentProvider) => Promise<boolean>
  pickOauthToken: () => string | null
  readOpenRouterKey?: () => Promise<string | null>
  projectId: string
  globalPromptAppend?: string
  stackProjects?: ResolvedStackBinding[]
  instructions?: Omit<KannaSystemPromptOptions, "stackProjects" | "globalPromptAppend">
}

function subagentPromptOptions(args: BuildSubagentProviderRunArgs): KannaSystemPromptOptions {
  return {
    globalPromptAppend: args.globalPromptAppend,
    ...args.instructions,
    stackProjects: args.stackProjects,
  }
}

export function buildSubagentProviderRun(args: BuildSubagentProviderRunArgs): ProviderRunStart {
  return {
    provider: args.subagent.provider,
    model: args.subagent.model,
    systemPrompt: args.subagent.systemPrompt,
    preamble: args.primer,
    maxTurns: args.subagent.maxTurns,
    nativeMaxTurns: args.subagent.provider === "claude" && !args.claudeDriverIsPty,
    authReady: async () => args.authReady(args.subagent.provider),
    async start(onChunk, onEntry, opts) {
      const initialPrompt = composeInitialPrompt(args.subagent, args.primer, args.userInstruction)
      const keepAlive = Boolean(opts?.keepAlive) && args.subagent.provider === "claude"
      if (args.subagent.provider === "claude" || args.subagent.provider === "openrouter") {
        const openrouterApiKey = args.subagent.provider === "openrouter"
          ? (await args.readOpenRouterKey?.() ?? null)
          : null
        return runClaudeSubagent({ args, initialPrompt, onChunk, onEntry, keepAlive, openrouterApiKey })
      }
      return runCodexSubagent({ args, initialPrompt, onChunk, onEntry })
    },
  }
}

export function composeSubagentSystemPrompt(
  subagentSystemPrompt: string,
  options: KannaSystemPromptOptions = {},
): string {
  const stackBlock = renderStackProjectsBlock(options.stackProjects ?? [])
  const instructionSections = renderInstructionSections(options)
  const sections = [subagentSystemPrompt.trimEnd()]
  if (instructionSections.length > 0) sections.push(instructionSections.join("\n"))
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
  openrouterApiKey: string | null
}): Promise<{ text: string; usage?: ProviderUsage; live?: LiveTurnSource }> {
  const { args, initialPrompt, onChunk, onEntry, keepAlive, openrouterApiKey } = opts
  const session = await args.startClaudeSession({
    projectId: args.projectId,
    localPath: args.cwd,
    additionalDirectories: args.additionalDirectories,
    model: args.subagent.model,
    effort: args.subagent.modelOptions?.reasoningEffort,
    planMode: false,
    sessionToken: null,
    forkSession: false,
    oauthToken: openrouterApiKey ? null : args.pickOauthToken(),
    openrouterApiKey,
    chatId: args.chatId,
    onToolRequest: args.onToolRequest,
    systemPromptOverride: composeSubagentSystemPrompt(args.subagent.systemPrompt, subagentPromptOptions(args)),
    initialPrompt,
    subagentOrchestrator: args.subagentOrchestrator,
    delegationContext: args.delegationContext,
    restrictedAllowedPaths: args.allowedPaths,
    keepAlive,
    maxTurns: args.subagent.maxTurns,
    getArmedLoop: args.getArmedLoop,
  })
  args.abortSignal.addEventListener("abort", () => { session.interrupt() }, { once: true })

  if (!keepAlive) {
    try {
      return await drainHarnessTurn(session, onChunk, onEntry)
    } finally {
      session.close()
    }
  }

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
      try { session.close() } catch { }
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
    developerInstructions: buildCodexDeveloperInstructions(subagentPromptOptions(args)),
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
    })
    return await drainHarnessTurn(turn, onChunk, onEntry)
  } finally {
    args.codexManager.stopSession(args.chatId, scope)
  }
}

export async function drainOneTurn(
  iterator: AsyncIterator<HarnessEvent>,
  onChunk: (chunk: string) => void,
  onEntry: (entry: TranscriptEntry) => void,
): Promise<{ text: string; usage?: ProviderUsage; sawResult: boolean; sawError: boolean }> {
  let accumulated = ""
  let usage: ProviderUsage | undefined
  let sawResult = false
  let sawError = false
  drain: while (true) {
    const next = await iterator.next()
    if (next.done) break
    const event = next.value
    switch (event.type) {
      case "session_token": break
      case "rate_limit": break
      case "transcript": {
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
          break drain
        }
        break
      }
      default: {
        const _never: never = event
        void _never
      }
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
  log.info("[kanna/subagent] drainHarnessTurn finished", {
    accumulatedChars: text.length,
    sawResult,
    sawError,
    hasUsage: Boolean(usage),
  })
  return { text, usage }
}
