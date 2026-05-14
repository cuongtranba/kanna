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

export interface ToolCallbackServiceArgs {
  store: EventStore
  serverSecret: string
  now: () => number
  timeoutMs: number
}

export interface ToolCallbackSubmitArgs {
  chatId: string
  sessionId: string
  toolUseId: string
  toolName: string
  args: Record<string, unknown>
  chatPolicy: ChatPermissionPolicy
  cwd: string
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
  cancelAllForSession(sessionId: string, reason: string): Promise<void>
  recoverOnStartup(): Promise<void>
  tickTimeouts(): Promise<void>
}

export function createToolCallbackService(opts: ToolCallbackServiceArgs): ToolCallbackService {
  interface PendingWaiter {
    resolve: (r: ToolCallbackResult) => void
    expiresAt: number
  }
  const waiters = new Map<string, PendingWaiter[]>()
  // Tracks the canonical (toolName, canonicalArgsHash) for each toolUseId
  // so we detect mismatched retries.
  const seenToolUseIds = new Map<string, { id: string; toolName: string; canonicalArgsHash: string }>()
  // In-memory mirror of persisted records keyed by id — lets submit() check
  // existing state synchronously (before the first await) so that concurrent
  // calls within the same event-loop turn see the correct state.
  const inMemory = new Map<string, ToolRequest>()

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

  async function persistPut(req: ToolRequest): Promise<void> {
    inMemory.set(req.id, { ...req })
    await opts.store.putToolRequest(req)
  }

  async function persistResolve(
    id: string,
    update: { status: ToolRequestStatus; decision: ToolRequestDecision; resolvedAt: number; mismatchReason?: string },
  ): Promise<void> {
    const existing = inMemory.get(id)
    if (existing) {
      inMemory.set(id, { ...existing, ...update })
    }
    await opts.store.resolveToolRequest(id, update)
  }

  const svc: ToolCallbackService = {
    submit(args) {
      const hash = canonicalArgsHash(args.args)
      const id = hmacId(args, hash)

      // ── Arg-mismatch check (synchronous, no I/O) ──────────────────────────
      const seen = seenToolUseIds.get(args.toolUseId)
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
        // Await persistence so a caller scanning the store after submit() sees the record.
        return persistPut(mismatchReq).then(() => ({ status: "arg_mismatch" as const, decision, mismatchReason: reason }))
      }

      // ── Idempotency: check in-memory mirror (synchronous) ─────────────────
      const existing = inMemory.get(id)
      if (existing && POLICY_TERMINAL_STATUSES.has(existing.status)) {
        return Promise.resolve({
          status: existing.status,
          decision: existing.decision ?? { kind: "deny", reason: "unknown" },
          mismatchReason: existing.mismatchReason,
        })
      }
      if (existing) {
        // Already pending — attach a new waiter.
        return new Promise<ToolCallbackResult>((resolve) => {
          const list = waiters.get(id) ?? []
          list.push({ resolve, expiresAt: existing.expiresAt })
          waiters.set(id, list)
        })
      }

      // ── New request ───────────────────────────────────────────────────────
      const verdict = policy.evaluate({
        toolName: args.toolName,
        args: args.args,
        chatPolicy: args.chatPolicy,
        cwd: args.cwd,
      })
      const now = opts.now()
      const expiresAt = now + opts.timeoutMs
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
        expiresAt,
      }

      // Register synchronously so subsequent calls within the same tick see it.
      inMemory.set(id, { ...req })
      seenToolUseIds.set(args.toolUseId, { id, toolName: args.toolName, canonicalArgsHash: hash })

      if (verdict.verdict === "auto-allow" || verdict.verdict === "auto-deny") {
        const decision: ToolRequestDecision = verdict.verdict === "auto-allow"
          ? { kind: "allow", reason: verdict.reason }
          : { kind: "deny", reason: verdict.reason }
        const resolvedReq: ToolRequest = { ...req, status: "answered", decision, resolvedAt: now }
        inMemory.set(id, resolvedReq)
        // Persist in background; caller gets immediate result.
        void (async () => {
          await opts.store.putToolRequest(req)
          await opts.store.resolveToolRequest(id, { status: "answered", decision, resolvedAt: now })
        })()
        return Promise.resolve({ status: "answered", decision })
      }

      // "ask" verdict → persist then wait for external answer.
      const pendingPromise = new Promise<ToolCallbackResult>((resolve) => {
        const list = waiters.get(id) ?? []
        list.push({ resolve, expiresAt })
        waiters.set(id, list)
      })
      void opts.store.putToolRequest(req)
      return pendingPromise
    },

    async answer(id, decision) {
      const existing = inMemory.get(id) ?? await opts.store.getToolRequest(id)
      if (!existing || POLICY_TERMINAL_STATUSES.has(existing.status)) return
      await persistResolve(id, { status: "answered", decision, resolvedAt: opts.now() })
      resolveWaiters(id, { status: "answered", decision })
    },

    async cancel(id, reason) {
      const existing = inMemory.get(id) ?? await opts.store.getToolRequest(id)
      if (!existing || POLICY_TERMINAL_STATUSES.has(existing.status)) return
      const decision: ToolRequestDecision = { kind: "deny", reason: `canceled: ${reason}` }
      await persistResolve(id, { status: "canceled", decision, resolvedAt: opts.now() })
      resolveWaiters(id, { status: "canceled", decision })
    },

    async cancelAllForChat(chatId, reason) {
      // Collect pending ids from in-memory mirror first (synchronous), then
      // also check store for any records loaded before this service started.
      const pendingIds = new Set<string>()
      for (const [id, req] of inMemory.entries()) {
        if (req.chatId === chatId && req.status === "pending") pendingIds.add(id)
      }
      const storeList = await opts.store.listPendingToolRequests(chatId)
      for (const req of storeList) pendingIds.add(req.id)
      for (const id of pendingIds) await svc.cancel(id, reason)
    },

    async cancelAllForSession(sessionId, reason) {
      const ids = Array.from(waiters.keys())
      for (const id of ids) {
        const req = inMemory.get(id) ?? await opts.store.getToolRequest(id)
        if (req && req.sessionId === sessionId) await svc.cancel(id, reason)
      }
    },

    async recoverOnStartup() {
      const all = await opts.store.scanAllToolRequests()
      for (const req of all) {
        if (req.status !== "pending") continue
        const decision: ToolRequestDecision = { kind: "deny", reason: "server_restarted" }
        await persistResolve(req.id, { status: "session_closed", decision, resolvedAt: opts.now() })
      }
    },

    async tickTimeouts() {
      const now = opts.now()
      for (const [id, list] of waiters.entries()) {
        if (list.length === 0) continue
        if (list[0].expiresAt > now) continue
        const decision: ToolRequestDecision = { kind: "deny", reason: "timeout" }
        await persistResolve(id, { status: "timeout", decision, resolvedAt: now })
        resolveWaiters(id, { status: "timeout", decision })
      }
    },
  }

  return svc
}

/**
 * Creates a ToolCallbackService and immediately calls recoverOnStartup()
 * to fail-close any pending tool requests left over from a previous server
 * run.  KANNA_SERVER_SECRET should be set in the environment for stable
 * HMAC ids within a process lifetime; if unset, a fresh random UUID is used
 * (cross-restart idempotency is not required because recoverOnStartup()
 * already closes all pending records).
 */
export async function initToolCallbackOnBoot(args: {
  store: EventStore
  serverSecret: string
  now?: () => number
  timeoutMs?: number
}): Promise<ToolCallbackService> {
  const svc = createToolCallbackService({
    store: args.store,
    serverSecret: args.serverSecret,
    now: args.now ?? (() => Date.now()),
    timeoutMs: args.timeoutMs ?? 600_000,
  })
  await svc.recoverOnStartup()
  return svc
}
