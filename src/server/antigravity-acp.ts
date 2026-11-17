import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"
import { errorMessage, toError } from "../shared/errors"
import { isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../shared/json"
import type { AntigravityReasoningEffort } from "../shared/provider-model-types"
import { timestamped } from "../shared/transcript-entry"
import type { TranscriptEntry } from "../shared/types"
import { AsyncQueue } from "./async-queue"
import { defaultSpawnAntigravityAcp } from "./antigravity-spawn.adapter"
import {
  ACP_METHOD_NOT_FOUND,
  allowOptionIdOf,
  decodeAcpMessage,
  decodeConfigState,
  decodePromptResult,
  decodeSessionNotification,
  decodeSessionSetup,
  encodeAcpMessage,
  type AcpConfigState,
  type AcpInbound,
  type AcpOutbound,
  type AcpPromptResult,
  type AcpRequestId,
  type AcpSessionSetup,
} from "./antigravity-acp-protocol"
import {
  AcpTurnTranslator,
  antigravityCompactBoundaryEntry,
  antigravityResultEntry,
  antigravitySystemInitEntry,
  type AcpPlanProposal,
} from "./antigravity-acp-translator"
import type { HarnessEvent, HarnessToolRequest, HarnessTurn } from "./harness-types"
import type { StdioProcess } from "./stdio-process"

export type SpawnAntigravityAcp = (cwd: string) => StdioProcess

export type AntigravitySessionScope = "main" | `sub:${string}`

export type AntigravityMcpServers = (chatId: string) => readonly JsonObject[]

export interface StartAntigravitySessionArgs {
  chatId: string
  scope?: AntigravitySessionScope
  cwd: string
  sessionToken: string | null
  developerInstructions?: string
}

export interface StartAntigravityTurnArgs {
  chatId: string
  scope?: AntigravitySessionScope
  model: string
  effort?: AntigravityReasoningEffort
  content: string
  planMode: boolean
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
}

interface PendingRequest {
  method: string
  resolve: (value: JsonValue) => void
  reject: (error: Error) => void
}

interface PendingTurn {
  id: string
  model: string
  planMode: boolean
  isCompact: boolean
  cancelRequested: boolean
  queue: AsyncQueue<HarnessEvent>
  translator: AcpTurnTranslator
  onToolRequest: StartAntigravityTurnArgs["onToolRequest"]
}

interface SessionContext {
  chatId: string
  scope: AntigravitySessionScope
  cwd: string
  child: StdioProcess
  nextRequestId: number
  pendingRequests: Map<AcpRequestId, PendingRequest>
  pendingTurn: PendingTurn | null
  sessionToken: string | null
  config: AcpConfigState
  planMode: boolean
  stderrLines: string[]
  closed: boolean
}

const STDERR_TAIL_LINES = 20
const COMPACT_PROMPT = /^\/compact(\s|$)/

function isRecoverableResumeError(error: Error): boolean {
  const message = errorMessage(error).toLowerCase()
  return ["failed to read session", "not found", "unknown session", "no such session", "does not exist"]
    .some((snippet) => message.includes(snippet))
}

function textPrompt(sessionId: string, text: string): JsonObject {
  return { sessionId, prompt: [{ type: "text", text }] }
}

export class AntigravityAcpManager {
  private readonly sessions = new Map<string, SessionContext>()
  private readonly spawnProcess: SpawnAntigravityAcp
  private readonly mcpServers: AntigravityMcpServers

  private static keyFor(chatId: string, scope: AntigravitySessionScope = "main"): string {
    if (scope === "sub:") {
      throw new Error(`Invalid AntigravitySessionScope: empty sub-id (got "sub:")`)
    }
    return `${chatId}::${scope}`
  }

  constructor(args: { spawnProcess?: SpawnAntigravityAcp; mcpServers?: AntigravityMcpServers } = {}) {
    this.spawnProcess = args.spawnProcess ?? defaultSpawnAntigravityAcp
    this.mcpServers = args.mcpServers ?? (() => [])
  }

  async startSession(args: StartAntigravitySessionArgs): Promise<string | null> {
    const scope: AntigravitySessionScope = args.scope ?? "main"
    const key = AntigravityAcpManager.keyFor(args.chatId, scope)
    const existing = this.sessions.get(key)
    if (existing && !existing.closed && existing.cwd === args.cwd) {
      return existing.sessionToken
    }
    if (existing) this.stopSession(args.chatId, scope)

    const context: SessionContext = {
      chatId: args.chatId,
      scope,
      cwd: args.cwd,
      child: this.spawnProcess(args.cwd),
      nextRequestId: 1,
      pendingRequests: new Map(),
      pendingTurn: null,
      sessionToken: null,
      config: { model: null, thoughtLevel: null },
      planMode: false,
      stderrLines: [],
      closed: false,
    }
    this.sessions.set(key, context)
    this.attachListeners(context)

    try {
      await this.request(context, "initialize", { protocolVersion: 1, clientCapabilities: {} })
      const setup = await this.openSession(context, args)
      context.sessionToken = setup.sessionId
      context.config = setup.config
    } catch (error) {
      this.stopSession(args.chatId, scope)
      throw error
    }
    return context.sessionToken
  }

  async startTurn(args: StartAntigravityTurnArgs): Promise<HarnessTurn> {
    const scope: AntigravitySessionScope = args.scope ?? "main"
    const context = this.requireSession(args.chatId, scope)
    if (context.pendingTurn) {
      throw new Error("Antigravity turn is already running")
    }

    const queue = new AsyncQueue<HarnessEvent>()
    if (context.sessionToken) {
      queue.push({ type: "session_token", sessionToken: context.sessionToken })
    }
    queue.push({ type: "transcript", entry: antigravitySystemInitEntry(args.model) })

    const turn: PendingTurn = {
      id: randomUUID(),
      model: args.model,
      planMode: args.planMode,
      isCompact: COMPACT_PROMPT.test(args.content.trimStart()),
      cancelRequested: false,
      queue,
      translator: new AcpTurnTranslator(),
      onToolRequest: args.onToolRequest,
    }
    context.pendingTurn = turn
    void this.runTurn(context, turn, args)

    return {
      provider: "antigravity",
      stream: queue,
      interrupt: async () => {
        if (context.pendingTurn !== turn || !context.sessionToken) return
        turn.cancelRequested = true
        this.write(context, { method: "session/cancel", params: { sessionId: context.sessionToken } })
      },
      close: () => {},
    }
  }

  stopSession(chatId: string, scope: AntigravitySessionScope = "main") {
    const key = AntigravityAcpManager.keyFor(chatId, scope)
    const context = this.sessions.get(key)
    if (!context) return
    context.closed = true
    context.pendingTurn?.queue.finish()
    context.pendingTurn = null
    this.sessions.delete(key)
    this.rejectPending(context, new Error("Antigravity session stopped"))
    try {
      context.child.kill("SIGKILL")
    } catch {
    }
  }

  stopAll() {
    for (const context of Array.from(this.sessions.values())) {
      this.stopSession(context.chatId, context.scope)
    }
  }

  activeSessionCount(): number {
    return this.sessions.size
  }

  hasSession(chatId: string, scope: AntigravitySessionScope = "main"): boolean {
    return this.sessions.has(AntigravityAcpManager.keyFor(chatId, scope))
  }

  private requireSession(chatId: string, scope: AntigravitySessionScope): SessionContext {
    const key = AntigravityAcpManager.keyFor(chatId, scope)
    const context = this.sessions.get(key)
    if (!context || context.closed) {
      throw new Error(`Antigravity session ${key} is not running`)
    }
    return context
  }

  private async openSession(context: SessionContext, args: StartAntigravitySessionArgs): Promise<AcpSessionSetup> {
    const mcpServers = context.scope === "main" ? [...this.mcpServers(context.chatId)] : []
    if (args.sessionToken) {
      try {
        const resumed = await this.request(context, "session/resume", {
          sessionId: args.sessionToken,
          cwd: args.cwd,
          mcpServers,
        })
        return decodeSessionSetup(resumed, args.sessionToken)
      } catch (error) {
        if (!isRecoverableResumeError(toError(error))) throw error
      }
    }
    const instructions = args.developerInstructions?.trim()
    const created = await this.request(context, "session/new", {
      cwd: args.cwd,
      mcpServers,
      ...(instructions ? { _meta: { antigravity: { systemPrompt: { append: instructions } } } } : {}),
    })
    return decodeSessionSetup(created, null)
  }

  private async runTurn(context: SessionContext, turn: PendingTurn, args: StartAntigravityTurnArgs) {
    try {
      await this.applyTurnSettings(context, args)
      if (turn.cancelRequested) throw new Error("cancelled before the prompt was sent")
      const sessionId = context.sessionToken ?? ""
      const response = await this.request(context, "session/prompt", textPrompt(sessionId, args.content))
      await this.finishTurn(context, turn, decodePromptResult(response))
    } catch (error) {
      if (context.pendingTurn !== turn) return
      const message = errorMessage(error)
      this.settleTurn(context, turn, [
        ...turn.translator.flush(),
        antigravityResultEntry(
          turn.cancelRequested
            ? { subtype: "cancelled", message: "", usage: null, model: turn.model }
            : { subtype: "error", message, usage: null, model: turn.model },
        ),
      ])
    }
  }

  private async applyTurnSettings(context: SessionContext, args: StartAntigravityTurnArgs) {
    const sessionId = context.sessionToken ?? ""
    if (context.config.model !== args.model) {
      await this.setConfigOption(context, "model", args.model)
    }
    if (args.effort !== undefined && context.config.thoughtLevel !== args.effort) {
      await this.setConfigOption(context, "thought_level", args.effort)
    }
    if (context.planMode !== args.planMode) {
      await this.request(context, "session/set_mode", { sessionId, modeId: args.planMode ? "plan" : "default" })
      context.planMode = args.planMode
    }
  }

  private async setConfigOption(context: SessionContext, configId: "model" | "thought_level", value: string) {
    const result = await this.request(context, "session/set_config_option", {
      sessionId: context.sessionToken ?? "",
      configId,
      value,
    })
    const returned = decodeConfigState(isJsonObject(result) ? result.configOptions : undefined)
    const requested: AcpConfigState = configId === "model"
      ? { model: value, thoughtLevel: context.config.thoughtLevel }
      : { model: context.config.model, thoughtLevel: value }
    context.config = {
      model: returned.model ?? requested.model,
      thoughtLevel: returned.thoughtLevel ?? requested.thoughtLevel,
    }
  }

  private async finishTurn(context: SessionContext, turn: PendingTurn, result: AcpPromptResult) {
    if (context.pendingTurn !== turn) return
    const entries = turn.translator.flush()
    const succeeded = result.stopReason === "end_turn"
    const cancelled = result.stopReason === "cancelled" || turn.cancelRequested

    if (succeeded && !cancelled && turn.planMode) {
      const proposal = turn.translator.planProposal
      if (proposal) {
        await this.requestPlanApproval(context, turn, entries, proposal)
        return
      }
    }

    if (succeeded && !cancelled && turn.isCompact) entries.push(antigravityCompactBoundaryEntry())
    if (cancelled) {
      entries.push(antigravityResultEntry({ subtype: "cancelled", message: "", usage: result.usage, model: turn.model }))
    } else if (succeeded) {
      entries.push(antigravityResultEntry({ subtype: "success", message: "", usage: result.usage, model: turn.model }))
    } else {
      entries.push(antigravityResultEntry({
        subtype: "error",
        message: `Antigravity stopped the turn: ${result.stopReason}`,
        usage: result.usage,
        model: turn.model,
      }))
    }
    this.settleTurn(context, turn, entries)
  }

  private async requestPlanApproval(
    context: SessionContext,
    turn: PendingTurn,
    entries: TranscriptEntry[],
    proposal: AcpPlanProposal,
  ) {
    const rawInput: JsonObject = proposal.summary === undefined
      ? { plan: proposal.plan }
      : { plan: proposal.plan, summary: proposal.summary }
    const tool = {
      kind: "tool" as const,
      toolKind: "exit_plan_mode" as const,
      toolName: "ExitPlanMode",
      toolId: `${turn.id}:exit-plan`,
      input: proposal,
      rawInput,
    }
    entries.push(timestamped({ kind: "tool_call", tool }))
    for (const entry of entries) turn.queue.push({ type: "transcript", entry })
    await turn.onToolRequest({ tool })
    this.settleTurn(context, turn, [])
  }

  private settleTurn(context: SessionContext, turn: PendingTurn, entries: readonly TranscriptEntry[]) {
    for (const entry of entries) turn.queue.push({ type: "transcript", entry })
    turn.queue.finish()
    if (context.pendingTurn === turn) context.pendingTurn = null
  }

  private attachListeners(context: SessionContext) {
    const lines = createInterface({ input: context.child.stdout })
    void (async () => {
      for await (const line of lines) {
        const parsed = safeJsonParse(line)
        const message = parsed === null ? null : decodeAcpMessage(parsed)
        if (message) this.handleMessage(context, message)
      }
    })()

    const stderr = createInterface({ input: context.child.stderr })
    void (async () => {
      for await (const line of stderr) {
        const text = line.trim()
        if (!text) continue
        context.stderrLines.push(text)
        if (context.stderrLines.length > STDERR_TAIL_LINES) context.stderrLines.shift()
      }
    })()

    context.child.stdin.on("error", (error) => {
      this.failContext(context, error.message)
    })
    context.child.on("error", (error) => {
      this.failContext(context, error.message)
    })
    context.child.on("close", (code) => {
      if (context.closed) return
      setImmediate(() => {
        if (context.closed) return
        this.failContext(context, context.stderrLines.at(-1) || `Antigravity agent exited with code ${code ?? 1}`)
      })
    })
  }

  private handleMessage(context: SessionContext, message: AcpInbound) {
    switch (message.kind) {
      case "response": {
        const pending = context.pendingRequests.get(message.id)
        if (!pending) return
        context.pendingRequests.delete(message.id)
        if (message.error !== null) {
          pending.reject(new Error(`${pending.method} failed: ${message.error}`))
          return
        }
        pending.resolve(message.result)
        return
      }
      case "request":
        this.handleAgentRequest(context, message.id, message.method, message.params)
        return
      case "notification":
        if (message.method === "session/update") this.handleSessionUpdate(context, message.params)
    }
  }

  private handleAgentRequest(context: SessionContext, id: AcpRequestId, method: string, params: JsonObject) {
    if (method !== "session/request_permission") {
      this.write(context, { id, error: { code: ACP_METHOD_NOT_FOUND, message: `Unsupported method: ${method}` } })
      return
    }
    const optionId = allowOptionIdOf(params)
    this.write(context, {
      id,
      result: { outcome: optionId === null ? { outcome: "cancelled" } : { outcome: "selected", optionId } },
    })
  }

  private handleSessionUpdate(context: SessionContext, params: JsonObject) {
    const notification = decodeSessionNotification(params)
    if (!notification) return
    if (context.sessionToken && notification.sessionId !== context.sessionToken) return
    const update = notification.update
    if (update.type === "config") {
      context.config = {
        model: update.config.model ?? context.config.model,
        thoughtLevel: update.config.thoughtLevel ?? context.config.thoughtLevel,
      }
      return
    }
    const turn = context.pendingTurn
    if (!turn) return
    for (const entry of turn.translator.accept(update)) {
      turn.queue.push({ type: "transcript", entry })
    }
  }

  private failContext(context: SessionContext, message: string) {
    const turn = context.pendingTurn
    if (turn) {
      this.settleTurn(context, turn, [
        ...turn.translator.flush(),
        antigravityResultEntry({ subtype: "error", message, usage: null, model: turn.model }),
      ])
    }
    this.rejectPending(context, new Error(message))
    context.closed = true
  }

  private rejectPending(context: SessionContext, error: Error) {
    for (const pending of context.pendingRequests.values()) {
      pending.reject(error)
    }
    context.pendingRequests.clear()
  }

  private request(context: SessionContext, method: string, params: JsonObject): Promise<JsonValue> {
    if (context.closed) return Promise.reject(new Error(`${method} failed: Antigravity session is closed`))
    const id = context.nextRequestId++
    const promise = new Promise<JsonValue>((resolve, reject) => {
      context.pendingRequests.set(id, { method, resolve, reject })
    })
    this.write(context, { id, method, params })
    return promise
  }

  private write(context: SessionContext, message: AcpOutbound) {
    context.child.stdin.write(encodeAcpMessage(message))
  }
}
