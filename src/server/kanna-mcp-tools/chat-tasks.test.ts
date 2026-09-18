import { expect, test } from "bun:test"
import { deriveChatTasks } from "../../shared/chat-tasks/read-model"
import type { ChatTaskScheduleContext } from "../../shared/chat-tasks/schedule"
import type { ChatTaskEvent } from "../../shared/chat-tasks/types"
import {
  claimChatTask,
  createChatTask,
  listChatTasks,
  noteChatTask,
  integrateChatTasks,
  settleChatTask,
  updateChatTask,
  type ChatTaskToolDeps,
} from "./chat-tasks"

function store(chatId: string, opts: { requireWorktree?: boolean; alive?: Set<string>; workdir?: string } = {}) {
  const byChat = new Map<string, ChatTaskEvent[]>()
  let seq = 0
  let chain: Promise<void> = Promise.resolve()
  const deps: ChatTaskToolDeps = {
    chatId,
    appendEvents: async (events) => {
      for (const event of events) {
        byChat.set(event.chatId, [...(byChat.get(event.chatId) ?? []), event])
      }
    },
    project: (ctx: ChatTaskScheduleContext) => deriveChatTasks(byChat.get(chatId) ?? [], ctx),
    decide: async (ctx, fn) => {
      let events: readonly ChatTaskEvent[] = []
      chain = chain.then(async () => {
        await Promise.resolve()
        events = fn(deriveChatTasks(byChat.get(chatId) ?? [], ctx))
        for (const event of events) {
          byChat.set(event.chatId, [...(byChat.get(event.chatId) ?? []), event])
        }
      })
      await chain
      return events
    },
    isRunAlive: (runId) => opts.alive?.has(runId) ?? false,
    requireWorktree: () => opts.requireWorktree ?? false,
    integrationWorkdir: () => opts.workdir ?? null,
    mergeBranch: async () => ({ ok: true, conflicts: [], detail: "" }),
    now: () => 1_000,
    newId: () => `id${String(++seq)}`,
  }
  return { deps, byChat }
}

test("a subagent writing with the parent chat id lands its task on the parent chat", async () => {
  const parent = store("parent-chat")
  const worker: ChatTaskToolDeps = { ...parent.deps, chatId: "parent-chat" }

  await createChatTask(worker, { subject: "Wire the store" })

  expect(parent.byChat.get("parent-chat")).toHaveLength(1)
  expect(parent.deps.project({ now: 1_000 }).tasks[0]?.subject).toBe("Wire the store")
})

test("concurrent claims never hand the same task to two workers", async () => {
  const { deps } = store("chat-1")
  await createChatTask(deps, { subject: "One" })
  await createChatTask(deps, { subject: "Two" })

  const [a, b] = await Promise.all([claimChatTask(deps), claimChatTask(deps)])

  expect(a.kind).toBe("claimed")
  expect(b.kind).toBe("claimed")
  const idA = a.kind === "claimed" ? a.task.id : ""
  const idB = b.kind === "claimed" ? b.task.id : ""
  expect(idA).not.toBe(idB)
})

test("a second claim with only one task waits rather than inventing one", async () => {
  const { deps } = store("chat-1")
  await createChatTask(deps, { subject: "Only one" })

  const first = await claimChatTask(deps)
  expect(first.kind).toBe("claimed")
  expect((await claimChatTask(deps)).kind).toBe("waiting")
})

test("settling a claim that was reclaimed underneath the worker refuses and says why", async () => {
  const { deps } = store("chat-1")
  await createChatTask(deps, { subject: "One" })
  const claimed = await claimChatTask(deps)
  expect(claimed.kind).toBe("claimed")

  const result = await settleChatTask(deps, { claimId: "not-the-live-claim", outcome: "done" })

  expect(result.ok).toBe(false)
  const error = result.ok ? "" : result.error
  expect(error).toContain("task_note")
})

test("settling done completes the task and it stops being claimable", async () => {
  const { deps } = store("chat-1")
  await createChatTask(deps, { subject: "One" })
  const claimed = await claimChatTask(deps)
  const claimId = claimed.kind === "claimed" ? claimed.claimId : ""

  const settled = await settleChatTask(deps, { claimId, outcome: "done" })

  expect(settled.ok).toBe(true)
  expect(listChatTasks(deps, {}).completed).toBe(1)
  expect((await claimChatTask(deps)).kind).toBe("exhausted")
})

test("releasing returns the task so a later iteration retries it", async () => {
  const { deps } = store("chat-1")
  await createChatTask(deps, { subject: "One" })
  const claimed = await claimChatTask(deps)
  const claimId = claimed.kind === "claimed" ? claimed.claimId : ""

  await settleChatTask(deps, { claimId, outcome: "release" })

  expect((await claimChatTask(deps)).kind).toBe("claimed")
})

test("creating a task whose needs name an unknown id is refused", async () => {
  const { deps } = store("chat-1")
  const result = await createChatTask(deps, { subject: "Dependent", needs: ["k:nope"] })

  expect(result.ok).toBe(false)
  expect(result.ok ? "" : result.error).toContain("unknown task id")
})

test("updating a task Kanna does not own reports the known ids instead of failing blank", async () => {
  const { deps } = store("chat-1")
  await createChatTask(deps, { subject: "Real" })

  const result = await updateChatTask(deps, { taskId: "k:ghost", status: "completed" })

  expect(result.ok).toBe(false)
  expect(result.ok ? "" : result.error).toContain("known ids")
})

test("a note is readable back against its task", async () => {
  const { deps } = store("chat-1")
  const created = await createChatTask(deps, { subject: "One" })
  const taskId = created.ok ? created.task.id : ""

  const noted = await noteChatTask(deps, { taskId, kind: "failed_approach", text: "variance mismatch" })

  expect(noted.ok).toBe(true)
  expect(deps.project({ now: 1_000 }).notes[0]?.text).toBe("variance mismatch")
})

test("task_integrate merges completed task branches and marks them integrated", async () => {
  const merged: string[] = []
  const base = store("chat-1", { workdir: "/wt/root" })
  const deps: ChatTaskToolDeps = {
    ...base.deps,
    mergeBranch: async (_workdir, branch) => {
      merged.push(branch)
      return { ok: true, conflicts: [], detail: "" }
    },
  }
  const created = await createChatTask(deps, { subject: "one", branch: "feat/one", worktree: "/wt/one" })
  const id = created.ok ? created.task.id : ""
  const claimed = await claimChatTask(deps)
  await settleChatTask(deps, { claimId: claimed.kind === "claimed" ? claimed.claimId : "", outcome: "done" })

  const result = await integrateChatTasks(deps)

  expect(result.kind).toBe("integrated")
  expect(merged).toEqual(["feat/one"])
  expect(deps.project({ now: 1_000 }).tasks.find((t) => t.id === id)?.integrated).toBe(true)
})

test("task_integrate stops at the first conflict and reports it as blocked", async () => {
  const base = store("chat-1", { workdir: "/wt/root" })
  const deps: ChatTaskToolDeps = {
    ...base.deps,
    mergeBranch: async () => ({ ok: false, conflicts: ["src/x.ts"], detail: "conflict in src/x.ts" }),
  }
  await createChatTask(deps, { subject: "one", branch: "feat/one", worktree: "/wt/one" })
  const claimed = await claimChatTask(deps)
  await settleChatTask(deps, { claimId: claimed.kind === "claimed" ? claimed.claimId : "", outcome: "done" })

  const result = await integrateChatTasks(deps)

  expect(result.kind).toBe("blocked")
  if (result.kind === "blocked") expect(result.detail).toContain("conflict")
})
