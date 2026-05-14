import crypto from "node:crypto"
import { LOG_PREFIX } from "../shared/branding"
import type {
  AgentProvider,
  ProviderUsage,
  Subagent,
  SubagentErrorCode,
  TranscriptEntry,
} from "../shared/types"
import type { EventStore } from "./event-store"
import { buildHistoryPrimer, extractPreviousAssistantReply } from "./history-primer"
import { parseMentions, type ParsedMention } from "./mention-parser"

export interface ProviderRunStart {
  provider: AgentProvider
  model: string
  systemPrompt: string
  preamble: string | null
  /**
   * Run the subagent against its provider.
   *  - `onChunk(text)`: every assistant_text fragment, in order. Used to
   *    persist `subagent_message_delta` events for streaming UI.
   *  - `onEntry(entry)`: every TranscriptEntry — including the assistant_text
   *    entries forwarded to onChunk, plus tool_call / tool_result / result.
   *    Used to persist `subagent_entry_appended` events.
   * Returns the final accumulated text + usage for the run_completed event.
   */
  start: (
    onChunk: (chunk: string) => void,
    onEntry: (entry: TranscriptEntry) => void,
  ) => Promise<{ text: string; usage?: ProviderUsage }>
  authReady: () => Promise<boolean>
}

export interface OrchestratorAppSettings {
  getSnapshot(): { subagents: Subagent[] }
}

export interface SubagentOrchestratorDeps {
  store: EventStore
  appSettings: OrchestratorAppSettings
  startProviderRun: (args: {
    subagent: Subagent
    chatId: string
    primer: string | null
    runId: string
  }) => ProviderRunStart
  now?: () => number
  maxParallel?: number
  maxChainDepth?: number
  runTimeoutMs?: number
}

const DEFAULT_MAX_PARALLEL = 4
const DEFAULT_MAX_CHAIN_DEPTH = 1
// Subagents now run with full toolset (Bash, Read, etc) so single turns may
// take minutes. 600s matches the default Bash tool wall-clock cap. Tests still
// override via SubagentOrchestratorDeps.runTimeoutMs.
const DEFAULT_RUN_TIMEOUT_MS = 600_000

export class SubagentOrchestrator {
  private permits: number
  private readonly waiters: Array<{ chatId: string; resolve: () => void; reject: (err: Error) => void }> = []
  private readonly cancelledChats = new Set<string>()

  constructor(private readonly deps: SubagentOrchestratorDeps) {
    this.permits = this.maxParallel()
  }

  private maxParallel() { return this.deps.maxParallel ?? DEFAULT_MAX_PARALLEL }
  private maxDepth() { return this.deps.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH }
  private timeoutMs() { return this.deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS }
  private now() { return this.deps.now?.() ?? Date.now() }

  activePermitCount() {
    return this.maxParallel() - this.permits
  }

  private async acquire(chatId: string): Promise<void> {
    if (this.cancelledChats.has(chatId)) {
      throw new Error("CHAT_CANCELLED")
    }
    if (this.permits > 0) {
      this.permits -= 1
      return
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    this.waiters.push({ chatId, resolve, reject })
    return promise
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) {
      next.resolve()
      return
    }
    this.permits += 1
  }

  cancelChat(chatId: string): void {
    this.cancelledChats.add(chatId)
    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      const w = this.waiters[i]
      if (w.chatId !== chatId) continue
      this.waiters.splice(i, 1)
      w.reject(new Error("CHAT_CANCELLED"))
    }
  }

  async runMentionsForUserMessage(args: {
    chatId: string
    userMessageId: string
    mentions: ParsedMention[]
  }): Promise<void> {
    const subagents = this.deps.appSettings.getSnapshot().subagents
    const resolved: { mention: Extract<ParsedMention, { kind: "subagent" }>; subagent: Subagent }[] = []

    for (const mention of args.mentions) {
      if (mention.kind === "unknown-subagent") {
        const runId = crypto.randomUUID()
        await this.deps.store.appendSubagentEvent({
          v: 3,
          type: "subagent_run_started",
          timestamp: this.now(),
          chatId: args.chatId,
          runId,
          subagentId: null,
          subagentName: mention.name,
          provider: "claude",
          model: "",
          parentUserMessageId: args.userMessageId,
          parentRunId: null,
          depth: 0,
        })
        await this.failRun(args.chatId, runId, "UNKNOWN_SUBAGENT", `Unknown subagent '${mention.name}'`)
        continue
      }
      const subagent = subagents.find((s) => s.id === mention.subagentId)
      if (!subagent) {
        const runId = crypto.randomUUID()
        await this.deps.store.appendSubagentEvent({
          v: 3,
          type: "subagent_run_started",
          timestamp: this.now(),
          chatId: args.chatId,
          runId,
          subagentId: mention.subagentId,
          subagentName: mention.subagentId,
          provider: "claude",
          model: "",
          parentUserMessageId: args.userMessageId,
          parentRunId: null,
          depth: 0,
        })
        await this.failRun(args.chatId, runId, "UNKNOWN_SUBAGENT", `Subagent ${mention.subagentId} was deleted`)
        continue
      }
      resolved.push({ mention, subagent })
    }

    await Promise.all(resolved.map(({ subagent }) =>
      this.spawnRun({
        subagent,
        chatId: args.chatId,
        parentUserMessageId: args.userMessageId,
        parentRunId: null,
        depth: 0,
        ancestorSubagentIds: [],
      })
    ))
  }

  private async spawnRun(args: {
    subagent: Subagent
    chatId: string
    parentUserMessageId: string
    parentRunId: string | null
    depth: number
    ancestorSubagentIds: string[]
  }): Promise<void> {
    const runId = crypto.randomUUID()
    await this.deps.store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_started",
      timestamp: this.now(),
      chatId: args.chatId,
      runId,
      subagentId: args.subagent.id,
      subagentName: args.subagent.name,
      provider: args.subagent.provider,
      model: args.subagent.model,
      parentUserMessageId: args.parentUserMessageId,
      parentRunId: args.parentRunId,
      depth: args.depth,
    })

    try {
      await this.acquire(args.chatId)
    } catch {
      await this.failRun(args.chatId, runId, "PROVIDER_ERROR", "Chat cancelled before run started")
      return
    }
    if (this.cancelledChats.has(args.chatId)) {
      this.release()
      await this.failRun(args.chatId, runId, "PROVIDER_ERROR", "Chat cancelled before run started")
      return
    }

    let released = false
    const releaseSlot = () => {
      if (released) return
      released = true
      this.release()
    }

    try {
      const transcript = this.deps.store.getMessages(args.chatId) as TranscriptEntry[]
      let primer: string | null
      if (args.subagent.contextScope === "full-transcript") {
        primer = buildHistoryPrimer(transcript, args.subagent.provider, "")
      } else {
        const reply = extractPreviousAssistantReply(transcript)
        primer = reply == null ? null : `Previous assistant reply:\n${reply}`
      }

      let runStart: ProviderRunStart
      try {
        runStart = this.deps.startProviderRun({
          subagent: args.subagent,
          chatId: args.chatId,
          primer,
          runId,
        })
      } catch (err) {
        // Defensive: startProviderRun is a synchronous factory but a real impl
        // (buildSubagentProviderRunForChat in agent.ts) can throw if e.g. the
        // chat's project lookup fails. Without this guard the run would leak
        // as `running` forever (no failed/completed event ever appended).
        const msg = err instanceof Error ? err.message : String(err)
        await this.failRun(args.chatId, runId, "PROVIDER_ERROR", msg)
        return
      }

      if (!(await runStart.authReady())) {
        await this.failRun(args.chatId, runId, "AUTH_REQUIRED", `Authentication required for ${args.subagent.provider}`)
        return
      }

      let finalText = ""
      let usage: ProviderUsage | undefined
      try {
        let timeoutId: ReturnType<typeof setTimeout> | null = null
        const onChunk = (chunk: string) => {
          if (!chunk) return
          this.deps.store
            .appendSubagentEvent({
              v: 3,
              type: "subagent_message_delta",
              timestamp: this.now(),
              chatId: args.chatId,
              runId,
              content: chunk,
            })
            .catch((err) => {
              console.warn(`${LOG_PREFIX} subagent delta append failed`, { chatId: args.chatId, runId, err })
            })
        }
        const onEntry = (entry: TranscriptEntry) => {
          this.deps.store
            .appendSubagentEvent({
              v: 3,
              type: "subagent_entry_appended",
              timestamp: this.now(),
              chatId: args.chatId,
              runId,
              entry,
            })
            .catch((err) => {
              console.warn(`${LOG_PREFIX} subagent entry append failed`, { chatId: args.chatId, runId, err })
            })
        }
        const result = await Promise.race([
          runStart.start(onChunk, onEntry),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("TIMEOUT")), this.timeoutMs())
          }),
        ]).finally(() => {
          if (timeoutId) clearTimeout(timeoutId)
        })
        finalText = result.text
        usage = result.usage
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === "TIMEOUT") {
          await this.failRun(args.chatId, runId, "TIMEOUT", `Run exceeded ${this.timeoutMs()}ms`)
        } else {
          await this.failRun(args.chatId, runId, "PROVIDER_ERROR", message)
        }
        return
      }

      await this.deps.store.appendSubagentEvent({
        v: 3,
        type: "subagent_run_completed",
        timestamp: this.now(),
        chatId: args.chatId,
        runId,
        finalContent: finalText,
        usage,
      })

      releaseSlot()

      const chainedMentions = parseMentions(finalText, this.deps.appSettings.getSnapshot().subagents)
      for (const mention of chainedMentions) {
        if (mention.kind !== "subagent") continue
        const chainSubagent = this.deps.appSettings.getSnapshot().subagents.find((s) => s.id === mention.subagentId)
        if (!chainSubagent) continue
        const childDepth = args.depth + 1
        if (childDepth > this.maxDepth()) {
          const childRunId = crypto.randomUUID()
          await this.deps.store.appendSubagentEvent({
            v: 3,
            type: "subagent_run_started",
            timestamp: this.now(),
            chatId: args.chatId,
            runId: childRunId,
            subagentId: chainSubagent.id,
            subagentName: chainSubagent.name,
            provider: chainSubagent.provider,
            model: chainSubagent.model,
            parentUserMessageId: args.parentUserMessageId,
            parentRunId: runId,
            depth: childDepth,
          })
          await this.failRun(args.chatId, childRunId, "DEPTH_EXCEEDED", `Chain depth ${childDepth} exceeds limit ${this.maxDepth()}`)
          continue
        }
        if ([...args.ancestorSubagentIds, args.subagent.id].includes(chainSubagent.id)) {
          const childRunId = crypto.randomUUID()
          await this.deps.store.appendSubagentEvent({
            v: 3,
            type: "subagent_run_started",
            timestamp: this.now(),
            chatId: args.chatId,
            runId: childRunId,
            subagentId: chainSubagent.id,
            subagentName: chainSubagent.name,
            provider: chainSubagent.provider,
            model: chainSubagent.model,
            parentUserMessageId: args.parentUserMessageId,
            parentRunId: runId,
            depth: childDepth,
          })
          await this.failRun(args.chatId, childRunId, "LOOP_DETECTED", `Subagent ${chainSubagent.name} already in ancestor chain`)
          continue
        }
        await this.spawnRun({
          subagent: chainSubagent,
          chatId: args.chatId,
          parentUserMessageId: args.parentUserMessageId,
          parentRunId: runId,
          depth: childDepth,
          ancestorSubagentIds: [...args.ancestorSubagentIds, args.subagent.id],
        })
      }
    } finally {
      releaseSlot()
    }
  }

  private async failRun(chatId: string, runId: string, code: SubagentErrorCode, message: string) {
    await this.deps.store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_failed",
      timestamp: this.now(),
      chatId,
      runId,
      error: { code, message },
    })
  }
}
