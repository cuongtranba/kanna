import { createHmac } from "node:crypto"
import type {
  ChatPermissionPolicy,
  ToolRequest,
  ToolRequestDecision,
  ToolRequestStatus,
} from "../shared/permission-policy"
import { POLICY_TERMINAL_STATUSES } from "../shared/permission-policy"
import { policy } from "./permission-gate"
import { canonicalArgsHash } from "./canonical-args"
import type { EventStore } from "./event-store"
import { log } from "../shared/log"
import type { JsonObject } from "../shared/json"

export interface ToolCallbackServiceArgs {
  store: EventStore
  serverSecret: string
  now: () => number
  onStateChange?: (chatId: string) => void
}

export interface ToolCallbackSubmitArgs {
  chatId: string
  sessionId: string
  toolUseId: string
  toolName: string
  args: JsonObject
  chatPolicy: ChatPermissionPolicy
  cwd: string
  restrictedAllowedPaths?: readonly string[]
}

export interface ToolCallbackResult {
  status: ToolRequestStatus
  decision: ToolRequestDecision
  mismatchReason?: string
}

export interface ToolCallbackService {
  submit(args: ToolCallbackSubmitArgs): Promise<ToolCallbackResult>
  answer(id: string, decision: ToolRequestDecision): Promise<void>
  cancel(id: string, reason: string): Promise<void>
  cancelAllForChat(chatId: string, reason: string): Promise<void>
  recoverOnStartup(): Promise<void>
}

const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER

export function createToolCallbackService(opts: ToolCallbackServiceArgs): ToolCallbackService {
  interface PendingWaiter {
    resolve: (r: ToolCallbackResult) => void
  }
  const waiters = new Map<string, PendingWaiter[]>()
  const seenToolUseIds = new Map<string, { id: string; toolName: string; canonicalArgsHash: string }>()
  function seenKey(s: { chatId: string; sessionId: string; toolUseId: string }): string {
    return `${s.chatId}|${s.sessionId}|${s.toolUseId}`
  }
  const inMemory = new Map<string, ToolRequest>()
  const pendingByContent = new Map<string, string>()
  const contentKeyById = new Map<string, string>()
  function contentKey(s: { chatId: string; sessionId: string; toolName: string }, hash: string): string {
    return `${s.chatId}|${s.sessionId}|${s.toolName}|${hash}`
  }
  function clearContentIndex(id: string): void {
    const key = contentKeyById.get(id)
    if (key === undefined) return
    contentKeyById.delete(id)
    if (pendingByContent.get(key) === id) pendingByContent.delete(key)
  }

  function hmacId(s: ToolCallbackSubmitArgs, hash: string): string {
    const h = createHmac("sha256", opts.serverSecret)
    h.update(`${s.chatId}|${s.sessionId}|${s.toolUseId}|${s.toolName}|${hash}`)
    return h.digest("hex")
  }

  function resolveWaiters(id: string, result: ToolCallbackResult) {
    const ws = waiters.get(id) ?? []
    waiters.delete(id)
    for (const w of ws) w.resolve(result)
  }

  function notify(chatId: string) {
    if (!opts.onStateChange) return
    try {
      opts.onStateChange(chatId)
    } catch (err) {
      log.warn("[tool-callback] onStateChange threw", String(err))
    }
  }

  async function persistPut(req: ToolRequest): Promise<void> {
    inMemory.set(req.id, { ...req })
    await opts.store.putToolRequest(req)
    notify(req.chatId)
  }

  async function persistResolve(
    id: string,
    update: { status: ToolRequestStatus; decision: ToolRequestDecision; resolvedAt: number; mismatchReason?: string },
  ): Promise<void> {
    const existing = inMemory.get(id)
    if (existing) {
      inMemory.set(id, { ...existing, ...update })
    }
    clearContentIndex(id)
    await opts.store.resolveToolRequest(id, update)
    if (existing) notify(existing.chatId)
  }

  const svc: ToolCallbackService = {
    submit(args) {
      const hash = canonicalArgsHash(args.args)
      const id = hmacId(args, hash)

      const seen = seenToolUseIds.get(seenKey(args))
      if (seen && (seen.toolName !== args.toolName || seen.canonicalArgsHash !== hash)) {
        const reason = `argument_mismatch: canonicalArgsHash differs from prior submission for toolUseId=${args.toolUseId}`
        const decision: ToolRequestDecision = { kind: "deny", reason }
        const now = opts.now()
        const mismatchReq: ToolRequest = {
          id,
          chatId: args.chatId,
          sessionId: args.sessionId,
          toolUseId: args.toolUseId,
          toolName: args.toolName,
          arguments: args.args,
          canonicalArgsHash: hash,
          policyVerdict: "auto-deny",
          status: "arg_mismatch",
          decision,
          mismatchReason: reason,
          createdAt: now,
          resolvedAt: now,
          expiresAt: now,
        }
        return persistPut(mismatchReq).then(() => ({ status: "arg_mismatch" as const, decision, mismatchReason: reason }))
      }

      const existing = inMemory.get(id)
      if (existing && POLICY_TERMINAL_STATUSES.has(existing.status)) {
        return Promise.resolve({
          status: existing.status,
          decision: existing.decision ?? { kind: "deny", reason: "unknown" },
          mismatchReason: existing.mismatchReason,
        })
      }
      if (existing) {
        return new Promise<ToolCallbackResult>((resolve) => {
          const list = waiters.get(id) ?? []
          list.push({ resolve })
          waiters.set(id, list)
        })
      }

      const cKey = contentKey(args, hash)
      const livePendingId = pendingByContent.get(cKey)
      if (livePendingId !== undefined) {
        const live = inMemory.get(livePendingId)
        if (live && live.status === "pending") {
          return new Promise<ToolCallbackResult>((resolve) => {
            const list = waiters.get(livePendingId) ?? []
            list.push({ resolve })
            waiters.set(livePendingId, list)
          })
        }
        clearContentIndex(livePendingId)
      }

      const verdict = policy.evaluate({
        toolName: args.toolName,
        args: args.args,
        chatPolicy: args.chatPolicy,
        cwd: args.cwd,
        restrictedAllowedPaths: args.restrictedAllowedPaths,
      })
      const now = opts.now()
      const req: ToolRequest = {
        id,
        chatId: args.chatId,
        sessionId: args.sessionId,
        toolUseId: args.toolUseId,
        toolName: args.toolName,
        arguments: args.args,
        canonicalArgsHash: hash,
        policyVerdict: verdict.verdict,
        status: "pending",
        createdAt: now,
        expiresAt: NEVER_EXPIRES,
      }

      inMemory.set(id, { ...req })
      seenToolUseIds.set(seenKey(args), { id, toolName: args.toolName, canonicalArgsHash: hash })

      if (verdict.verdict === "auto-allow" || verdict.verdict === "auto-deny") {
        const decision: ToolRequestDecision = verdict.verdict === "auto-allow"
          ? { kind: "allow", reason: verdict.reason }
          : { kind: "deny", reason: verdict.reason }
        const resolvedReq: ToolRequest = { ...req, status: "answered", decision, resolvedAt: now }
        inMemory.set(id, resolvedReq)
        void (async () => {
          await opts.store.putToolRequest(req)
          await opts.store.resolveToolRequest(id, { status: "answered", decision, resolvedAt: now })
        })()
        return Promise.resolve({ status: "answered", decision })
      }

      pendingByContent.set(cKey, id)
      contentKeyById.set(id, cKey)
      const pendingPromise = new Promise<ToolCallbackResult>((resolve) => {
        const list = waiters.get(id) ?? []
        list.push({ resolve })
        waiters.set(id, list)
      })
      void persistPut(req)
      return pendingPromise
    },

    async answer(id, decision) {
      const existing = inMemory.get(id) ?? opts.store.getToolRequest(id)
      if (!existing || POLICY_TERMINAL_STATUSES.has(existing.status)) return
      await persistResolve(id, { status: "answered", decision, resolvedAt: opts.now() })
      resolveWaiters(id, { status: "answered", decision })
    },

    async cancel(id, reason) {
      const existing = inMemory.get(id) ?? opts.store.getToolRequest(id)
      if (!existing || POLICY_TERMINAL_STATUSES.has(existing.status)) return
      const decision: ToolRequestDecision = { kind: "deny", reason: `canceled: ${reason}` }
      await persistResolve(id, { status: "canceled", decision, resolvedAt: opts.now() })
      resolveWaiters(id, { status: "canceled", decision })
    },

    async cancelAllForChat(chatId, reason) {
      const pendingIds = new Set<string>()
      for (const [id, req] of inMemory.entries()) {
        if (req.chatId === chatId && req.status === "pending") pendingIds.add(id)
      }
      const storeList = opts.store.listPendingToolRequests(chatId)
      for (const req of storeList) pendingIds.add(req.id)
      for (const id of pendingIds) await svc.cancel(id, reason)
    },

    async recoverOnStartup() {
      const all = opts.store.scanAllToolRequests()
      for (const req of all) {
        if (req.status !== "pending") continue
        const decision: ToolRequestDecision = { kind: "deny", reason: "server_restarted" }
        await persistResolve(req.id, { status: "session_closed", decision, resolvedAt: opts.now() })
      }
    },
  }

  return svc
}

export async function initToolCallbackOnBoot(args: {
  store: EventStore
  serverSecret: string
  now?: () => number
  onStateChange?: (chatId: string) => void
}): Promise<ToolCallbackService> {
  const svc = createToolCallbackService({
    store: args.store,
    serverSecret: args.serverSecret,
    now: args.now ?? (() => Date.now()),
    onStateChange: args.onStateChange,
  })
  await svc.recoverOnStartup()
  return svc
}
