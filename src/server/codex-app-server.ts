import { randomUUID } from "node:crypto"
import { resolveModelPrice } from "../shared/token-pricing"
import { defaultSpawnCodexAppServer } from "./codex-spawn.adapter"
import { createInterface } from "node:readline"
import type { Readable, Writable } from "node:stream"
import type {
  CodexReasoningEffort,
  ContextWindowUsageSnapshot,
  ServiceTier,
} from "../shared/types"
import { relocateExternalFileIntoProject } from "./projectFileRelocation.adapter"
import type { HarnessEvent, HarnessToolRequest, HarnessTurn } from "./harness-types"
import {
  type ContextCompactedNotification,
  type CodexRequestId,
  type CommandExecutionApprovalDecision,
  type CommandExecutionRequestApprovalParams,
  type CommandExecutionRequestApprovalResponse,
  type DynamicToolCallResponse,
  type FileChangeApprovalDecision,
  type FileChangeRequestApprovalParams,
  type FileChangeRequestApprovalResponse,
  type InitializeParams,
  type ItemCompletedNotification,
  type ItemStartedNotification,
  type JsonRpcResponse,
  type PlanDeltaNotification,
  type ServerNotification,
  type ServerRequest,
  type ThreadResumeParams,
  type ThreadResumeResponse,
  type ThreadForkParams,
  type ThreadForkResponse,
  type ThreadStartParams,
  type ThreadStartResponse,
  type ThreadTokenUsageUpdatedNotification,
  type TurnPlanStep,
  type TurnPlanUpdatedNotification,
  type TurnCompletedNotification,
  type TurnInterruptParams,
  type TurnStartParams,
  type TurnStartResponse,
  isJsonRpcResponse,
  isServerNotification,
  isServerRequest,
} from "./codex-app-server-protocol"
import { safeJsonParse } from "../shared/safe-json"
import { type AnyValue, errorMessage as sharedErrorMessage } from "../shared/errors"
import { type CodexErrorInfo } from "../shared/codex-error-classification"
import {
  type TranslationContext,
  asRecord,
  buildResultEntry,
  codexSystemInitEntry,
  createTranscriptEntry,
  dynamicToolPayload,
  genericDynamicToolCall,
  normalizeCodexTokenUsage,
  renderPlanMarkdownFromSteps,
  todoToolCall,
  toAskUserQuestionItems,
  toToolRequestUserInputResponse,
  translateItemToToolCalls,
  translateItemToToolResults,
  webSearchQuery,
  DEFERRED_DYNAMIC_TOOLS,
} from "./codex-transcript-translator"
export { normalizeCodexTokenUsage } from "./codex-transcript-translator"

export interface CodexAppServerProcess {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  killed?: boolean
  kill(signal?: NodeJS.Signals | number): void
  on(event: "close", listener: (code: number | null) => void): this
  on(event: "error", listener: (error: Error) => void): this
  once(event: "close", listener: (code: number | null) => void): this
  once(event: "error", listener: (error: Error) => void): this
}

export type SpawnCodexAppServer = (cwd: string) => CodexAppServerProcess

interface PendingRequest<TResult> {
  method: string
  resolve: (value: TResult) => void
  reject: (error: Error) => void
}

interface PendingTurn {
  turnId: string | null
  model: string
  planMode: boolean
  queue: AsyncQueue<HarnessEvent>
  startedToolIds: Set<string>
  handledDynamicToolIds: Set<string>
  latestPlanExplanation: string | null
  latestPlanSteps: TurnPlanStep[]
  latestPlanText: string | null
  planTextByItemId: Map<string, string>
  todoSequence: number
  pendingWebSearchResultToolId: string | null
  resolved: boolean
  /** Most recent token usage snapshot for the turn; stashed to enrich the result entry. */
  lastUsageSnapshot?: ContextWindowUsageSnapshot
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
  onApprovalRequest?: (
    request:
      | {
          requestId: CodexRequestId
          kind: "command_execution"
          params: CommandExecutionRequestApprovalParams
        }
      | {
          requestId: CodexRequestId
          kind: "file_change"
          params: FileChangeRequestApprovalParams
        }
  ) => Promise<CommandExecutionApprovalDecision | FileChangeApprovalDecision>
}

interface SessionContext {
  chatId: string
  scope: CodexSessionScope
  cwd: string
  projectId: string | null
  child: CodexAppServerProcess
  pendingRequests: Map<CodexRequestId, PendingRequest<AnyValue>>
  pendingTurn: PendingTurn | null
  sessionToken: string | null
  stderrLines: string[]
  closed: boolean
}

export type CodexSessionScope = "main" | `sub:${string}`

export interface StartCodexSessionArgs {
  chatId: string
  scope?: CodexSessionScope
  cwd: string
  projectId?: string | null
  model: string
  serviceTier?: ServiceTier
  sessionToken: string | null
  pendingForkSessionToken?: string | null
}

export interface StartCodexTurnArgs {
  chatId: string
  scope?: CodexSessionScope
  model: string
  effort?: CodexReasoningEffort
  serviceTier?: ServiceTier
  content: string
  planMode: boolean
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
  onApprovalRequest?: PendingTurn["onApprovalRequest"]
  /**
   * Forwarded into `collaborationMode.settings.developer_instructions` on
   * `turn/start`. Empty / whitespace-only sends `null` (Codex-native absent).
   * Mirrors the Claude `--append-system-prompt` channel for global prompts.
   */
  developerInstructions?: string
}

export interface GenerateStructuredArgs {
  cwd: string
  prompt: string
  model?: string
  effort?: CodexReasoningEffort
  serviceTier?: ServiceTier
}

function isRecoverableResumeError(error: AnyValue): boolean {
  const message = sharedErrorMessage(error).toLowerCase()
  if (!message.includes("thread/resume")) return false
  return ["not found", "missing thread", "no such thread", "unknown thread", "does not exist"].some((snippet) =>
    message.includes(snippet)
  )
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private resolvers: Array<(value: IteratorResult<T>) => void> = []
  private done = false

  push(value: T) {
    if (this.done) return
    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver({ value, done: false })
      return
    }
    this.values.push(value)
  }

  finish() {
    if (this.done) return
    this.done = true
    const doneResult: IteratorReturnResult<undefined> = { value: undefined, done: true }
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()
      resolver?.(doneResult)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const doneResult: IteratorReturnResult<undefined> = { value: undefined, done: true }
    return {
      next: () => {
        if (this.values.length > 0) {
          const next = this.values.shift()
          if (next !== undefined) {
            return Promise.resolve({ value: next, done: false as const })
          }
        }
        if (this.done) {
          return Promise.resolve(doneResult)
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve)
        })
      },
    }
  }
}

export class CodexAppServerManager {
  private readonly sessions = new Map<string, SessionContext>()
  private readonly spawnProcess: SpawnCodexAppServer

  private static keyFor(chatId: string, scope: CodexSessionScope = "main"): string {
    if (scope === "sub:") {
      throw new Error(`Invalid CodexSessionScope: empty sub-id (got "sub:")`)
    }
    return `${chatId}::${scope}`
  }

  constructor(args: { spawnProcess?: SpawnCodexAppServer } = {}) {
    this.spawnProcess = args.spawnProcess ?? defaultSpawnCodexAppServer
  }

  async startSession(args: StartCodexSessionArgs) {
    const scope: CodexSessionScope = args.scope ?? "main"
    const key = CodexAppServerManager.keyFor(args.chatId, scope)
    const existing = this.sessions.get(key)
    if (existing && !existing.closed && existing.cwd === args.cwd && !args.pendingForkSessionToken) {
      return
    }

    if (existing) {
      this.stopSession(args.chatId, scope)
    }

    const child = this.spawnProcess(args.cwd)
    const context: SessionContext = {
      chatId: args.chatId,
      scope,
      cwd: args.cwd,
      projectId: args.projectId ?? null,
      child,
      pendingRequests: new Map(),
      pendingTurn: null,
      sessionToken: null,
      stderrLines: [],
      closed: false,
    }
    this.sessions.set(key, context)
    this.attachListeners(context)

    await this.sendRequest(context, "initialize", {
      clientInfo: {
        name: "kanna_desktop",
        title: "Kanna",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    } satisfies InitializeParams)
    this.writeMessage(context, {
      method: "initialized",
    })

    const threadParams = {
      model: args.model,
      cwd: args.cwd,
      serviceTier: args.serviceTier,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    } satisfies ThreadStartParams

    let response: ThreadStartResponse | ThreadResumeResponse | ThreadForkResponse
    if (args.pendingForkSessionToken) {
      response = await this.sendRequest<ThreadForkResponse>(context, "thread/fork", {
        threadId: args.pendingForkSessionToken,
        model: args.model,
        cwd: args.cwd,
        serviceTier: args.serviceTier,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        persistExtendedHistory: false,
      } satisfies ThreadForkParams)
    } else if (args.sessionToken) {
      try {
        response = await this.sendRequest<ThreadResumeResponse>(context, "thread/resume", {
          threadId: args.sessionToken,
          model: args.model,
          cwd: args.cwd,
          serviceTier: args.serviceTier,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          persistExtendedHistory: false,
        } satisfies ThreadResumeParams)
      } catch (error) {
        if (!isRecoverableResumeError(error)) {
          this.stopSession(args.chatId, scope)
          throw error
        }
        response = await this.sendRequest<ThreadStartResponse>(context, "thread/start", threadParams)
      }
    } else {
      response = await this.sendRequest<ThreadStartResponse>(context, "thread/start", threadParams)
    }

    context.sessionToken = response.thread.id
    return context.sessionToken
  }

  async startTurn(args: StartCodexTurnArgs): Promise<HarnessTurn> {
    const scope: CodexSessionScope = args.scope ?? "main"
    const context = this.requireSession(args.chatId, scope)
    if (context.pendingTurn) {
      throw new Error("Codex turn is already running")
    }

    const queue = new AsyncQueue<HarnessEvent>()
    if (context.sessionToken) {
      queue.push({ type: "session_token", sessionToken: context.sessionToken })
    }
    queue.push({ type: "transcript", entry: codexSystemInitEntry(args.model) })

    const pendingTurn: PendingTurn = {
      turnId: null,
      model: args.model,
      planMode: args.planMode,
      queue,
      startedToolIds: new Set(),
      handledDynamicToolIds: new Set(),
      latestPlanExplanation: null,
      latestPlanSteps: [],
      latestPlanText: null,
      planTextByItemId: new Map(),
      todoSequence: 0,
      pendingWebSearchResultToolId: null,
      resolved: false,
      onToolRequest: args.onToolRequest,
      onApprovalRequest: args.onApprovalRequest,
    }
    context.pendingTurn = pendingTurn

    try {
      const response = await this.sendRequest<TurnStartResponse>(context, "turn/start", {
        threadId: context.sessionToken ?? "",
        input: [
          {
            type: "text",
            text: args.content,
            text_elements: [],
          },
        ],
        approvalPolicy: "never",
        model: args.model,
        effort: args.effort,
        serviceTier: args.serviceTier,
        collaborationMode: {
          mode: args.planMode ? "plan" : "default",
          settings: {
            model: args.model,
            reasoning_effort: null,
            developer_instructions: args.developerInstructions?.trim()
              ? args.developerInstructions.trim()
              : null,
          },
        },
      } satisfies TurnStartParams)
      if (context.pendingTurn) {
        context.pendingTurn.turnId = response.turn.id
      } else {
        pendingTurn.turnId = response.turn.id
      }
    } catch (error) {
      context.pendingTurn = null
      queue.finish()
      throw error
    }

    return {
      provider: "codex",
      stream: queue,
      interrupt: async () => {
        const pendingTurn = context.pendingTurn
        if (!pendingTurn) return

        context.pendingTurn = null
        pendingTurn.resolved = true
        pendingTurn.queue.finish()

        if (!pendingTurn.turnId || !context.sessionToken) return

        await this.sendRequest(context, "turn/interrupt", {
          threadId: context.sessionToken,
          turnId: pendingTurn.turnId,
        } satisfies TurnInterruptParams)
      },
      close: () => {},
    }
  }

  async generateStructured(args: GenerateStructuredArgs): Promise<string | null> {
    const chatId = `quick-${randomUUID()}`
    let turn: HarnessTurn | null = null
    let assistantText = ""
    let resultText = ""

    try {
      await this.startSession({
        chatId,
        cwd: args.cwd,
        model: args.model ?? "gpt-5.5",
        serviceTier: args.serviceTier ?? "fast",
        sessionToken: null,
      })

      turn = await this.startTurn({
        chatId,
        model: args.model ?? "gpt-5.5",
        effort: args.effort,
        serviceTier: args.serviceTier ?? "fast",
        content: args.prompt,
        planMode: false,
        onToolRequest: async () => ({}),
      })

      for await (const event of turn.stream) {
        if (event.type !== "transcript" || !event.entry) continue
        if (event.entry.kind === "assistant_text") {
          assistantText += assistantText ? `\n${event.entry.text}` : event.entry.text
        }
        if (event.entry.kind === "result" && !event.entry.isError && event.entry.result.trim()) {
          resultText = event.entry.result
        }
      }

      const candidate = assistantText.trim() || resultText.trim()
      return candidate || null
    } finally {
      turn?.close()
      this.stopSession(chatId)
    }
  }

  stopSession(chatId: string, scope: CodexSessionScope = "main") {
    const key = CodexAppServerManager.keyFor(chatId, scope)
    const context = this.sessions.get(key)
    if (!context) return
    context.closed = true
    context.pendingTurn?.queue.finish()
    this.sessions.delete(key)
    try {
      context.child.kill("SIGKILL")
    } catch {
      // ignore kill failures
    }
  }

  stopAll() {
    // Snapshot the values first because stopSession mutates the map.
    const contexts = Array.from(this.sessions.values())
    for (const ctx of contexts) {
      this.stopSession(ctx.chatId, ctx.scope)
    }
  }

  activeSessionCount(): number {
    return this.sessions.size
  }

  hasSession(chatId: string, scope: CodexSessionScope = "main"): boolean {
    return this.sessions.has(CodexAppServerManager.keyFor(chatId, scope))
  }

  private requireSession(chatId: string, scope: CodexSessionScope = "main"): SessionContext {
    const key = CodexAppServerManager.keyFor(chatId, scope)
    const context = this.sessions.get(key)
    if (!context || context.closed) {
      throw new Error(`Codex session ${key} is not running`)
    }
    return context
  }

  private buildTranslationContext(context: SessionContext): TranslationContext {
    return {
      projectId: context.projectId,
      cwd: context.cwd,
      relocate: (path) => relocateExternalFileIntoProject(path, context.cwd).relativePath,
    }
  }

  private attachListeners(context: SessionContext) {
    const lines = createInterface({ input: context.child.stdout })
    void (async () => {
      for await (const line of lines) {
        const parsed = safeJsonParse(line)
        if (!parsed) continue

        if (isJsonRpcResponse(parsed)) {
          this.handleResponse(context, parsed)
          continue
        }

        if (isServerRequest(parsed)) {
          void this.handleServerRequest(context, parsed)
          continue
        }

        if (isServerNotification(parsed)) {
          void this.handleNotification(context, parsed)
        }
      }
    })()

    const stderr = createInterface({ input: context.child.stderr })
    void (async () => {
      for await (const line of stderr) {
        if (line.trim()) {
          context.stderrLines.push(line.trim())
        }
      }
    })()

    context.child.on("error", (error) => {
      this.failContext(context, error.message)
    })

    context.child.on("close", (code) => {
      if (context.closed) return
      queueMicrotask(() => {
        if (context.closed) return
        const message = context.stderrLines.at(-1) || `Codex app-server exited with code ${code ?? 1}`
        this.failContext(context, message)
      })
    })
  }

  private handleResponse(context: SessionContext, response: JsonRpcResponse) {
    const pending = context.pendingRequests.get(response.id)
    if (!pending) return
    context.pendingRequests.delete(response.id)
    if (response.error) {
      pending.reject(new Error(`${pending.method} failed: ${response.error.message ?? "Unknown error"}`))
      return
    }
    pending.resolve(response.result)
  }

  private async handleServerRequest(context: SessionContext, request: ServerRequest) {
    const pendingTurn = context.pendingTurn
    if (!pendingTurn) {
      this.writeMessage(context, {
        id: request.id,
        error: {
          message: "No active turn",
        },
      })
      return
    }

    if (request.method === "item/tool/requestUserInput") {
      const questions = toAskUserQuestionItems(request.params)
      const toolId = request.params.itemId
      const toolRequest: HarnessToolRequest = {
        tool: {
          kind: "tool",
          toolKind: "ask_user_question",
          toolName: "AskUserQuestion",
          toolId,
          input: { questions },
          rawInput: {
            questions: request.params.questions,
          },
        },
      }
      pendingTurn.queue.push({
        type: "transcript",
        entry: createTranscriptEntry({
          kind: "tool_call",
          tool: toolRequest.tool,
        }),
      })

      const result = await pendingTurn.onToolRequest(toolRequest)
      this.writeMessage(context, {
        id: request.id,
        result: toToolRequestUserInputResponse(result, request.params.questions),
      })
      return
    }

    if (request.method === "item/tool/call") {
      pendingTurn.handledDynamicToolIds.add(request.params.callId)
      if (request.params.tool === "update_plan") {
        const args = asRecord(request.params.arguments)
        const plan = Array.isArray(args?.plan) ? args.plan : []
        const steps: TurnPlanStep[] = plan
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
          .map((entry) => {
            let status: TurnPlanStep["status"]
            if (entry.status === "completed") {
              status = "completed"
            } else if (entry.status === "inProgress" || entry.status === "in_progress") {
              status = "inProgress"
            } else {
              status = "pending"
            }
            return {
              step: typeof entry.step === "string" ? entry.step : "",
              status,
            }
          })
          .filter((step) => step.step.length > 0)

        if (steps.length > 0) {
          pendingTurn.latestPlanSteps = steps
          pendingTurn.latestPlanExplanation = typeof args?.explanation === "string" ? args.explanation : pendingTurn.latestPlanExplanation
          pendingTurn.queue.push({
            type: "transcript",
            entry: todoToolCall(request.params.callId, steps),
          })
          pendingTurn.queue.push({
            type: "transcript",
            entry: createTranscriptEntry({
              kind: "tool_result",
              toolId: request.params.callId,
              content: "",
            }),
          })
        }

        this.writeMessage(context, {
          id: request.id,
          result: {
            contentItems: [],
            success: true,
          } satisfies DynamicToolCallResponse,
        })
        return
      }

      const payload = dynamicToolPayload(request.params.arguments)
      pendingTurn.queue.push({
        type: "transcript",
        entry: genericDynamicToolCall(request.params.callId, request.params.tool, payload),
      })
      const errorMessage = `Unsupported dynamic tool call: ${request.params.tool}`
      pendingTurn.queue.push({
        type: "transcript",
        entry: createTranscriptEntry({
          kind: "tool_result",
          toolId: request.params.callId,
          content: errorMessage,
          isError: true,
        }),
      })
      this.writeMessage(context, {
        id: request.id,
        result: {
          contentItems: [{ type: "inputText", text: errorMessage }],
          success: false,
        } satisfies DynamicToolCallResponse,
      })
      return
    }

    if (request.method === "item/commandExecution/requestApproval") {
      const decision = await pendingTurn.onApprovalRequest?.({
        requestId: request.id,
        kind: "command_execution",
        params: request.params,
      }) ?? "decline"
      this.writeMessage(context, {
        id: request.id,
        result: {
          decision,
        } satisfies CommandExecutionRequestApprovalResponse,
      })
      return
    }

    const decision = await pendingTurn.onApprovalRequest?.({
      requestId: request.id,
      kind: "file_change",
      params: request.params,
    }) ?? "decline"
    this.writeMessage(context, {
      id: request.id,
      result: {
        decision,
      } satisfies FileChangeRequestApprovalResponse,
    })
  }

  private async handleNotification(context: SessionContext, notification: ServerNotification) {
    if (notification.method === "thread/started") {
      context.sessionToken = notification.params.thread.id
      if (context.pendingTurn) {
        context.pendingTurn.queue.push({
          type: "session_token",
          sessionToken: notification.params.thread.id,
        })
      }
      return
    }

    const pendingTurn = context.pendingTurn
    if (!pendingTurn) return

    switch (notification.method) {
      case "thread/tokenUsage/updated":
        this.handleTokenUsageUpdated(pendingTurn, notification.params)
        return
      case "turn/plan/updated":
        this.handlePlanUpdated(pendingTurn, notification.params)
        return
      case "item/started":
        this.handleItemStarted(context, pendingTurn, notification.params)
        return
      case "item/completed":
        this.handleItemCompleted(context, pendingTurn, notification.params)
        return
      case "item/plan/delta":
        this.handlePlanDelta(pendingTurn, notification.params)
        return
      case "turn/completed":
        await this.handleTurnCompleted(context, notification.params)
        return
      case "thread/compacted":
        this.handleContextCompacted(pendingTurn, notification.params)
        return
      case "error":
        // `willRetry` means codex is reconnecting on its own and the turn is
        // still alive; failing it here kills a turn that would have recovered.
        if (notification.params.willRetry === true) return
        this.failContext(
          context,
          notification.params.error.message,
          notification.params.error.codexErrorInfo,
        )
        break
      default:
        
    }
  }

  private handleItemStarted(context: SessionContext, pendingTurn: PendingTurn, notification: ItemStartedNotification) {
    if (notification.item.type === "plan") {
      pendingTurn.planTextByItemId.set(notification.item.id, notification.item.text)
      pendingTurn.latestPlanText = notification.item.text
      return
    }

    if (
      notification.item.type === "commandExecution"
      || notification.item.type === "webSearch"
      || notification.item.type === "mcpToolCall"
      || notification.item.type === "dynamicToolCall"
      || notification.item.type === "collabAgentToolCall"
      || notification.item.type === "fileChange"
      || notification.item.type === "error"
    ) {
      if (pendingTurn.handledDynamicToolIds.has(notification.item.id)) {
        return
      }
      if (notification.item.type === "webSearch" && !webSearchQuery(notification.item)) {
        return
      }
    }

    if (notification.item.type === "dynamicToolCall" && DEFERRED_DYNAMIC_TOOLS.has(notification.item.tool)) {
      // Defer emission to item/completed — `started` args carry placeholders
      // (e.g. ImageGeneration's `{revisedPrompt:null, status:"in_progress"}`).
      return
    }

    const entries = translateItemToToolCalls(notification.item, context.projectId)
    for (const entry of entries) {
      if (entry.kind === "tool_call") {
        pendingTurn.startedToolIds.add(entry.tool.toolId)
      }
      pendingTurn.queue.push({ type: "transcript", entry })
    }
  }

  private handleItemCompleted(context: SessionContext, pendingTurn: PendingTurn, notification: ItemCompletedNotification) {
    if (notification.item.type === "agentMessage") {
      if (!notification.item.text.trim()) {
        return
      }
      pendingTurn.queue.push({
        type: "transcript",
        entry: createTranscriptEntry({
          kind: "assistant_text",
          text: notification.item.text,
        }),
      })
      if (pendingTurn.pendingWebSearchResultToolId && notification.item.text.trim()) {
        pendingTurn.queue.push({
          type: "transcript",
          entry: createTranscriptEntry({
            kind: "tool_result",
            toolId: pendingTurn.pendingWebSearchResultToolId,
            content: notification.item.text,
          }),
        })
        pendingTurn.pendingWebSearchResultToolId = null
      }
      return
    }

    if (notification.item.type === "plan") {
      pendingTurn.planTextByItemId.set(notification.item.id, notification.item.text)
      pendingTurn.latestPlanText = notification.item.text
      return
    }

    if (pendingTurn.handledDynamicToolIds.has(notification.item.id)) {
      return
    }

    const startedEntries = translateItemToToolCalls(notification.item, context.projectId)
    for (const entry of startedEntries) {
      if (entry.kind !== "tool_call") {
        continue
      }
      if (pendingTurn.startedToolIds.has(entry.tool.toolId)) {
        continue
      }
      pendingTurn.startedToolIds.add(entry.tool.toolId)
      pendingTurn.queue.push({ type: "transcript", entry })
    }

    const resultEntries = translateItemToToolResults(notification.item, this.buildTranslationContext(context))
    for (const entry of resultEntries) {
      pendingTurn.queue.push({ type: "transcript", entry })
      if (notification.item.type === "webSearch" && entry.kind === "tool_result" && !entry.isError) {
        pendingTurn.pendingWebSearchResultToolId = notification.item.id
      }
    }
  }

  private handlePlanUpdated(pendingTurn: PendingTurn, notification: TurnPlanUpdatedNotification) {
    pendingTurn.latestPlanExplanation = notification.explanation ?? null
    pendingTurn.latestPlanSteps = notification.plan
    if (notification.plan.length === 0) {
      return
    }
    pendingTurn.todoSequence += 1
    pendingTurn.queue.push({
      type: "transcript",
      entry: todoToolCall(
        `${notification.turnId}:todo-${pendingTurn.todoSequence}`,
        notification.plan
      ),
    })
  }

  private handlePlanDelta(pendingTurn: PendingTurn, notification: PlanDeltaNotification) {
    const current = pendingTurn.planTextByItemId.get(notification.itemId) ?? ""
    const next = `${current}${notification.delta}`
    pendingTurn.planTextByItemId.set(notification.itemId, next)
    pendingTurn.latestPlanText = next
  }

  private handleContextCompacted(pendingTurn: PendingTurn, _notification: ContextCompactedNotification) {
    pendingTurn.queue.push({
      type: "transcript",
      entry: createTranscriptEntry({ kind: "compact_boundary" }),
    })
  }

  private handleTokenUsageUpdated(
    pendingTurn: PendingTurn,
    notification: ThreadTokenUsageUpdatedNotification,
  ) {
    const usage = normalizeCodexTokenUsage(notification, () => resolveModelPrice(pendingTurn.model))
    if (!usage) {
      return
    }

    // Stash the latest snapshot so handleTurnCompleted can enrich the result entry.
    pendingTurn.lastUsageSnapshot = usage

    pendingTurn.queue.push({
      type: "transcript",
      entry: createTranscriptEntry({
        kind: "context_window_updated",
        usage,
      }),
    })
  }

  private async handleTurnCompleted(context: SessionContext, notification: TurnCompletedNotification) {
    const pendingTurn = context.pendingTurn
    if (!pendingTurn) return
    const status = notification.turn.status
    const isCancelled = status === "interrupted"
    const isError = status === "failed"
    pendingTurn.pendingWebSearchResultToolId = null

    if (!isCancelled && !isError && pendingTurn.planMode) {
      const planText = pendingTurn.latestPlanText?.trim()
        || renderPlanMarkdownFromSteps(pendingTurn.latestPlanSteps).trim()

      if (planText) {
        pendingTurn.turnId = null
        const tool = {
          kind: "tool" as const,
          toolKind: "exit_plan_mode" as const,
          toolName: "ExitPlanMode",
          toolId: `${notification.turn.id}:exit-plan`,
          input: {
            plan: planText,
            summary: pendingTurn.latestPlanExplanation ?? undefined,
          },
          rawInput: {
            plan: planText,
            summary: pendingTurn.latestPlanExplanation ?? undefined,
          },
        }
        pendingTurn.queue.push({
          type: "transcript",
          entry: createTranscriptEntry({
            kind: "tool_call",
            tool,
          }),
        })
        await pendingTurn.onToolRequest({ tool })
        pendingTurn.resolved = true
        pendingTurn.queue.finish()
        context.pendingTurn = null
        return
      }
    }

    pendingTurn.resolved = true
    let subtype: "cancelled" | "error" | "success"
    if (isCancelled) {
      subtype = "cancelled"
    } else if (isError) {
      subtype = "error"
    } else {
      subtype = "success"
    }
    pendingTurn.queue.push({
      type: "transcript",
      entry: buildResultEntry(subtype, notification.turn.error?.message ?? "", notification.turn.error?.codexErrorInfo, pendingTurn.lastUsageSnapshot),
    })
    pendingTurn.queue.finish()
    context.pendingTurn = null
  }

  private failContext(context: SessionContext, message: string, errorInfo?: CodexErrorInfo | null) {
    const pendingTurn = context.pendingTurn
    if (pendingTurn && !pendingTurn.resolved) {
      pendingTurn.queue.push({
        type: "transcript",
        entry: buildResultEntry("error", message, errorInfo, pendingTurn.lastUsageSnapshot),
      })
      pendingTurn.queue.finish()
      context.pendingTurn = null
    }

    for (const pending of context.pendingRequests.values()) {
      pending.reject(new Error(message))
    }
    context.pendingRequests.clear()
    context.closed = true
  }

  private async sendRequest<TResult>(context: SessionContext, method: string, params: AnyValue): Promise<TResult> {
    const id = randomUUID()
    const promise = new Promise<TResult>((resolve, reject) => {
      context.pendingRequests.set(id, <PendingRequest<AnyValue>>{
        method,
        resolve: <(value: AnyValue) => void>resolve,
        reject,
      })
    })
    this.writeMessage(context, {
      id,
      method,
      params,
    })
    return await promise
  }

  private writeMessage(context: SessionContext, message: Record<string, unknown>) {
    context.child.stdin.write(`${JSON.stringify(message)}\n`)
  }
}
