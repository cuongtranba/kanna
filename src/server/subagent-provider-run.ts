import type { HarnessToolRequest, HarnessTurn } from "./harness-types"
import type { CodexAppServerManager } from "./codex-app-server"
import type {
  AgentProvider,
  ProviderUsage,
  Subagent,
  TranscriptEntry,
} from "../shared/types"
import type { ClaudeSessionHandle } from "./agent"
import type { ProviderRunStart } from "./subagent-orchestrator"

/**
 * Builds a ProviderRunStart for a single subagent run. Each call returns a
 * fresh ProviderRunStart bound to one (subagent, chatId) pair — the orchestrator
 * invokes start() exactly once per run, then discards.
 */
export interface BuildSubagentProviderRunArgs {
  subagent: Subagent
  chatId: string
  primer: string | null
  runId: string
  /** Project cwd shared with the parent chat. */
  cwd: string
  additionalDirectories?: string[]
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
  }) => Promise<ClaudeSessionHandle>
  codexManager: CodexAppServerManager
  /** Forwards interactive tool requests (AskUserQuestion / ExitPlanMode) to the parent chat's UI handler. */
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
  /** Resolves credentials per provider. Returns false → run fails AUTH_REQUIRED. */
  authReady: (provider: AgentProvider) => Promise<boolean>
  /** Picks an oauth token for Claude runs, or null. Subagents share the primary pool. */
  pickOauthToken: () => string | null
  projectId: string
}

export function buildSubagentProviderRun(args: BuildSubagentProviderRunArgs): ProviderRunStart {
  return {
    provider: args.subagent.provider,
    model: args.subagent.model,
    systemPrompt: args.subagent.systemPrompt,
    preamble: args.primer,
    authReady: async () => args.authReady(args.subagent.provider),
    async start(onChunk, onEntry) {
      const initialPrompt = composeInitialPrompt(args.subagent, args.primer)
      if (args.subagent.provider === "claude") {
        return runClaudeSubagent({ args, initialPrompt, onChunk, onEntry })
      }
      return runCodexSubagent({ args, initialPrompt, onChunk, onEntry })
    },
  }
}

function composeInitialPrompt(subagent: Subagent, primer: string | null): string {
  return primer ?? `(no prior context — proceed based on your system prompt and the @agent/${subagent.name} mention)`
}

async function runClaudeSubagent(opts: {
  args: BuildSubagentProviderRunArgs
  initialPrompt: string
  onChunk: (chunk: string) => void
  onEntry: (entry: TranscriptEntry) => void
}): Promise<{ text: string; usage?: ProviderUsage }> {
  const { args, initialPrompt, onChunk, onEntry } = opts
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
    systemPromptOverride: args.subagent.systemPrompt,
    initialPrompt,
  })
  try {
    return await drainHarnessTurn(session, onChunk, onEntry)
  } finally {
    session.close()
  }
}

async function runCodexSubagent(opts: {
  args: BuildSubagentProviderRunArgs
  initialPrompt: string
  onChunk: (chunk: string) => void
  onEntry: (entry: TranscriptEntry) => void
}): Promise<{ text: string; usage?: ProviderUsage }> {
  const { args, initialPrompt, onChunk, onEntry } = opts
  const scope = `sub:${args.runId}` as const
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
      effort: args.subagent.modelOptions?.reasoningEffort as never,
      serviceTier: undefined,
      planMode: false,
      onToolRequest: args.onToolRequest,
    })
    return await drainHarnessTurn(turn, onChunk, onEntry)
  } finally {
    args.codexManager.stopSession(args.chatId, scope)
  }
}

async function drainHarnessTurn(
  turn: HarnessTurn,
  onChunk: (chunk: string) => void,
  onEntry: (entry: TranscriptEntry) => void,
): Promise<{ text: string; usage?: ProviderUsage }> {
  let accumulated = ""
  let usage: ProviderUsage | undefined
  for await (const event of turn.stream) {
    if (event.type !== "transcript" || !event.entry) continue
    onEntry(event.entry)
    if (event.entry.kind === "assistant_text") {
      const fragment = event.entry.text
      accumulated += fragment
      onChunk(fragment)
    } else if (event.entry.kind === "result") {
      const e = event.entry
      usage = {
        inputTokens: e.usage?.inputTokens,
        outputTokens: e.usage?.outputTokens,
        cachedInputTokens: e.usage?.cachedInputTokens,
        costUsd: e.costUsd,
      }
    }
  }
  return { text: accumulated, usage }
}
