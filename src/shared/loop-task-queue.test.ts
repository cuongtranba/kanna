import { describe, expect, test } from "bun:test"

import {
  TASK_QUEUE_CLAIM_GRACE_MS,
  bindRun,
  claimNextTask,
  markIntegrated,
  readTaskQueue,
  settleTask,
  validateTaskQueue,
  type TaskQueueContext,
} from "./loop-task-queue"
import { markdownDoc } from "./structured-doc/markdown"

const NOW = Date.parse("2026-09-11T10:00:00.000Z")

function doc(...tasks: string[]): string {
  return [
    "# Loop tracking file",
    "",
    "## Task queue",
    "",
    ...tasks,
    "",
    "## Progress (latest first)",
    "",
    "- 2026-09-10 bootstrapped the plan",
    "",
  ].join("\n")
}

const QUEUE = doc(
  "- [ ] t1 User model and migrations | worktree: ../w1 | branch: loop/t1",
  "- [ ] t2 Authentication | needs: t1 | worktree: ../w2 | branch: loop/t2",
  "- [ ] t3 Settings page | worktree: ../w3 | branch: loop/t3",
)

function ctx(content: string, now: number = NOW): TaskQueueContext {
  return { content, doc: markdownDoc, now }
}

function claim(content: string, claimId: string, now: number = NOW) {
  const outcome = claimNextTask(ctx(content, now), { claimId })
  if (outcome.kind !== "claimed") throw new Error(`expected a claim, got ${outcome.kind}`)
  return outcome
}

describe("readTaskQueue", () => {
  test("parses id, text, dependencies and worktree metadata off each item", () => {
    const tasks = readTaskQueue(ctx(QUEUE))
    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toMatchObject({
      id: "t1",
      text: "User model and migrations",
      state: "available",
      needs: [],
      worktree: "../w1",
      branch: "loop/t1",
    })
    expect(tasks[1]).toMatchObject({ id: "t2", needs: ["t1"], worktree: "../w2" })
  })

  test("reads the three checkbox states and a claim stamp", () => {
    const tasks = readTaskQueue(
      ctx(
        doc(
          "- [x] t1 Done thing | worktree: ../w1 | integrated",
          "- [~] t2 Leased thing | worktree: ../w2 | claim: abc123 @2026-09-11T09:59:30.000Z | run: r7",
          "- [ ] t3 Open thing | worktree: ../w3",
        ),
      ),
    )
    expect(tasks.map((t) => t.state)).toEqual(["done", "leased", "available"])
    expect(tasks[0].integrated).toBe(true)
    expect(tasks[1].claimId).toBe("abc123")
    expect(tasks[1].claimedAt).toBe(Date.parse("2026-09-11T09:59:30.000Z"))
    expect(tasks[1].runId).toBe("r7")
    expect(tasks[1].stale).toBe(false)
  })

  test("a claim that never bound a run is reclaimable once past the grace period", () => {
    const stamped = new Date(NOW - TASK_QUEUE_CLAIM_GRACE_MS - 1000).toISOString()
    const tasks = readTaskQueue(
      ctx(doc(`- [~] t1 Abandoned | worktree: ../w1 | claim: gone @${stamped}`)),
    )
    expect(tasks[0].state).toBe("leased")
    expect(tasks[0].stale).toBe(true)
  })

  test("a claim inside the grace period is respected, so delegation has time to bind its run", () => {
    const stamped = new Date(NOW - 1000).toISOString()
    const tasks = readTaskQueue(
      ctx(doc(`- [~] t1 Launching | worktree: ../w1 | claim: c1 @${stamped}`)),
    )
    expect(tasks[0].stale).toBe(false)
  })

  test("a missing queue section yields no tasks rather than throwing", () => {
    expect(readTaskQueue(ctx("# Nothing here\n"))).toEqual([])
  })
})

describe("claimNextTask", () => {
  test("claims the first available task and stamps the lease into the file", () => {
    const outcome = claim(QUEUE, "c1")
    expect(outcome.task.id).toBe("t1")
    expect(outcome.task.worktree).toBe("../w1")

    const after = readTaskQueue(ctx(outcome.content))
    expect(after[0]).toMatchObject({ id: "t1", state: "leased", claimId: "c1", claimedAt: NOW })
    expect(after[1].state).toBe("available")
  })

  test("rewrites only the claimed item, leaving every other byte of the file alone", () => {
    const outcome = claim(QUEUE, "c1")
    const restored = outcome.content.replace(
      `- [~] t1 User model and migrations | worktree: ../w1 | branch: loop/t1 | claim: c1 @${new Date(NOW).toISOString()}`,
      "- [ ] t1 User model and migrations | worktree: ../w1 | branch: loop/t1",
    )
    expect(restored).toBe(QUEUE)
  })

  test("a task whose dependency is unfinished is never handed out", () => {
    const first = claim(QUEUE, "c1")
    const second = claim(first.content, "c2")
    expect(second.task.id).toBe("t3")

    const third = claimNextTask(ctx(second.content), { claimId: "c3" })
    expect(third.kind).toBe("waiting")
  })

  test("the dependent unblocks only once its dependency is done", () => {
    const claimed = claim(QUEUE, "c1")
    const blocked = claimNextTask(
      ctx(settleTaskContent(claimed.content, "c1", "release")),
      { claimId: "cx" },
    )
    expect(blocked.kind).toBe("claimed")
    if (blocked.kind === "claimed") expect(blocked.task.id).toBe("t1")

    const done = settleTaskContent(claimed.content, "c1", "done")
    const next = claim(done, "c2")
    expect(next.task.id).toBe("t2")
  })

  test("a worktree already held by a live lease is skipped, never double-booked", () => {
    const shared = doc(
      "- [ ] t1 First | worktree: ../shared",
      "- [ ] t2 Second | worktree: ../shared",
      "- [ ] t3 Third | worktree: ../w3",
    )
    const first = claim(shared, "c1")
    expect(first.task.id).toBe("t1")
    const second = claim(first.content, "c2")
    expect(second.task.id).toBe("t3")
  })

  test("a stale lease releases its worktree and its task for reclaim", () => {
    const stamped = new Date(NOW - TASK_QUEUE_CLAIM_GRACE_MS - 1000).toISOString()
    const abandoned = doc(`- [~] t1 Abandoned | worktree: ../w1 | claim: gone @${stamped}`)
    const outcome = claim(abandoned, "c2")
    expect(outcome.task.id).toBe("t1")
    expect(readTaskQueue(ctx(outcome.content))[0].claimId).toBe("c2")
  })

  test("a task with no worktree is refused with a problem naming it, not silently skipped", () => {
    const outcome = claimNextTask(ctx(doc("- [ ] t1 Homeless task")), { claimId: "c1" })
    expect(outcome.kind).toBe("blocked")
    if (outcome.kind === "blocked") {
      expect(outcome.problems).toContainEqual({ kind: "missing_worktree", id: "t1" })
    }
  })

  test("reports waiting while a live lease could still unblock the rest", () => {
    const first = claim(doc(
      "- [ ] t1 Foundation | worktree: ../w1",
      "- [ ] t2 Dependent | needs: t1 | worktree: ../w2",
    ), "c1")
    const outcome = claimNextTask(ctx(first.content), { claimId: "c2" })
    expect(outcome.kind).toBe("waiting")
    if (outcome.kind === "waiting") expect(outcome.leased.map((t) => t.id)).toEqual(["t1"])
  })

  test("reports exhausted when every task is done", () => {
    const outcome = claimNextTask(
      ctx(doc("- [x] t1 Done | worktree: ../w1", "- [x] t2 Done | worktree: ../w2")),
      { claimId: "c1" },
    )
    expect(outcome.kind).toBe("exhausted")
  })

  test("a dependency cycle is a deadlock, not an endless wait", () => {
    const outcome = claimNextTask(
      ctx(doc(
        "- [ ] t1 A | needs: t2 | worktree: ../w1",
        "- [ ] t2 B | needs: t1 | worktree: ../w2",
      )),
      { claimId: "c1" },
    )
    expect(outcome.kind).toBe("blocked")
    if (outcome.kind === "blocked") {
      expect(outcome.problems.some((p) => p.kind === "cycle")).toBe(true)
    }
  })

  test("a dependency on an id that does not exist is a deadlock", () => {
    const outcome = claimNextTask(
      ctx(doc("- [ ] t1 A | needs: ghost | worktree: ../w1")),
      { claimId: "c1" },
    )
    expect(outcome.kind).toBe("blocked")
    if (outcome.kind === "blocked") {
      expect(outcome.problems).toContainEqual({
        kind: "unknown_dependency",
        id: "t1",
        needs: "ghost",
      })
    }
  })
})

describe("lease recovery keyed on run liveness", () => {
  const LEASED_BY_DEAD_RUN = doc(
    `- [~] t1 Foundation | worktree: ../w1 | claim: c1 @${new Date(NOW - 5000).toISOString()} | run: dead-run`,
    "- [ ] t2 Dependent | needs: t1 | worktree: ../w2",
  )

  function withLiveness(content: string, alive: readonly string[]): TaskQueueContext {
    return { ...ctx(content), isRunAlive: (runId) => alive.includes(runId) }
  }

  test("a worker that failed without releasing its lease does not stall the loop forever", () => {
    const outcome = claimNextTask(withLiveness(LEASED_BY_DEAD_RUN, []), { claimId: "c2" })
    expect(outcome.kind).toBe("claimed")
    if (outcome.kind !== "claimed") return
    expect(outcome.task.id).toBe("t1")
    expect(readTaskQueue(ctx(outcome.content))[0].claimId).toBe("c2")
  })

  test("a lease whose run is still alive is never stolen, however old the claim", () => {
    const ancient = doc(
      `- [~] t1 Long runner | worktree: ../w1 | claim: c1 @${new Date(NOW - 86_400_000).toISOString()} | run: live-run`,
      "- [ ] t2 Dependent | needs: t1 | worktree: ../w2",
    )
    const outcome = claimNextTask(withLiveness(ancient, ["live-run"]), { claimId: "c2" })
    expect(outcome.kind).toBe("waiting")
  })

  test("bindRun records the delegated run so the lease becomes recoverable", () => {
    const claimed = claim(QUEUE, "c1")
    const bound = bindRun(ctx(claimed.content), { claimId: "c1", runId: "run-9" })
    expect(bound.kind).toBe("ok")
    if (bound.kind !== "ok") return
    expect(readTaskQueue(ctx(bound.content))[0].runId).toBe("run-9")

    const reclaimed = claimNextTask(withLiveness(bound.content, []), { claimId: "c2" })
    expect(reclaimed.kind).toBe("claimed")
  })

  test("a run-bound lease survives without a liveness probe, so a caller that cannot check waits", () => {
    const outcome = claimNextTask(ctx(LEASED_BY_DEAD_RUN), { claimId: "c2" })
    expect(outcome.kind).toBe("waiting")
  })
})

describe("settleTask", () => {
  test("done marks the task [x] and drops the lease", () => {
    const claimed = claim(QUEUE, "c1")
    const settled = settleTask(ctx(claimed.content), { claimId: "c1", outcome: "done" })
    expect(settled.kind).toBe("ok")
    if (settled.kind !== "ok") return
    const task = readTaskQueue(ctx(settled.content))[0]
    expect(task).toMatchObject({ id: "t1", state: "done", claimId: null })
  })

  test("release returns the task to the queue so a failure is retried, not lost", () => {
    const claimed = claim(QUEUE, "c1")
    const settled = settleTask(ctx(claimed.content), { claimId: "c1", outcome: "release" })
    expect(settled.kind).toBe("ok")
    if (settled.kind !== "ok") return
    expect(readTaskQueue(ctx(settled.content))[0]).toMatchObject({
      id: "t1",
      state: "available",
      claimId: null,
    })
  })

  test("release restores the item to its pre-claim bytes", () => {
    const claimed = claim(QUEUE, "c1")
    const settled = settleTask(ctx(claimed.content), { claimId: "c1", outcome: "release" })
    if (settled.kind !== "ok") throw new Error("expected ok")
    expect(settled.content).toBe(QUEUE)
  })

  test("an unknown claim id settles nothing", () => {
    const claimed = claim(QUEUE, "c1")
    expect(settleTask(ctx(claimed.content), { claimId: "nope", outcome: "done" }).kind).toBe(
      "not_found",
    )
  })
})

describe("markIntegrated", () => {
  test("flags a done task as integrated so the orchestrator merges it exactly once", () => {
    const claimed = claim(QUEUE, "c1")
    const settled = settleTask(ctx(claimed.content), { claimId: "c1", outcome: "done" })
    if (settled.kind !== "ok") throw new Error("expected ok")
    expect(readTaskQueue(ctx(settled.content))[0].integrated).toBe(false)

    const marked = markIntegrated(ctx(settled.content), { taskId: "t1" })
    expect(marked.kind).toBe("ok")
    if (marked.kind !== "ok") return
    expect(readTaskQueue(ctx(marked.content))[0].integrated).toBe(true)
  })
})

describe("validateTaskQueue", () => {
  test("a well-formed queue has no problems", () => {
    expect(validateTaskQueue(readTaskQueue(ctx(QUEUE)))).toEqual([])
  })

  test("duplicate ids are reported, since a claim would otherwise be ambiguous", () => {
    const tasks = readTaskQueue(
      ctx(doc("- [ ] t1 A | worktree: ../w1", "- [ ] t1 B | worktree: ../w2")),
    )
    expect(validateTaskQueue(tasks)).toContainEqual({ kind: "duplicate_id", id: "t1" })
  })
})

function settleTaskContent(
  content: string,
  claimId: string,
  outcome: "done" | "release",
): string {
  const settled = settleTask(ctx(content), { claimId, outcome })
  if (settled.kind !== "ok") throw new Error("expected ok")
  return settled.content
}
