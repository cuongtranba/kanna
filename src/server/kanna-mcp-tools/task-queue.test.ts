import { describe, expect, test } from "bun:test"

import { confinePathToDir } from "../input-validation"
import { withFileLock } from "../tracking-file-lock"
import { bindClaimToRun, claimTrackingTask, completeTrackingTask, type TaskQueueToolDeps } from "./task-queue"

const BASE = "/loop"

const QUEUE = [
  "# Loop tracking file",
  "",
  "## Task queue",
  "",
  "- [ ] t1 User model | worktree: ../w1 | branch: loop/t1",
  "- [ ] t2 Authentication | needs: t1 | worktree: ../w2 | branch: loop/t2",
  "- [ ] t3 Settings page | worktree: ../w3 | branch: loop/t3",
  "",
].join("\n")

function makeDeps(options?: {
  content?: string
  alive?: readonly string[]
  slowRead?: boolean
}): TaskQueueToolDeps & { files: Map<string, string> } {
  const files = new Map<string, string>([[`${BASE}/PROGRESS.md`, options?.content ?? QUEUE]])
  let claimSeq = 0
  return {
    files,
    chatId: "chat-1",
    baseDir: () => BASE,
    readDoc: async (abs) => {
      if (options?.slowRead) await Promise.resolve()
      return files.get(abs) ?? null
    },
    writeDoc: async (abs, content) => {
      files.set(abs, content)
    },
    withFileLock,
    isRunAlive: (_chatId, runId) => (options?.alive ?? []).includes(runId),
    confinePath: confinePathToDir,
    now: () => Date.parse("2026-09-11T10:00:00.000Z"),
    newClaimId: () => {
      claimSeq += 1
      return `claim-${claimSeq}`
    },
  }
}

function parse(text: string): Record<string, unknown> {
  return JSON.parse(text)
}

describe("claim_tracking_task", () => {
  test("hands out the first claimable task with everything the worker needs", async () => {
    const deps = makeDeps()
    const result = await claimTrackingTask(deps, {})
    expect(result.isError).toBe(false)
    expect(parse(result.text)).toMatchObject({
      status: "claimed",
      claim_id: "claim-1",
      task_id: "t1",
      worktree: "../w1",
      branch: "loop/t1",
    })
  })

  test("concurrent claims never hand out the same task", async () => {
    const deps = makeDeps({ slowRead: true })
    const [a, b] = await Promise.all([claimTrackingTask(deps, {}), claimTrackingTask(deps, {})])
    const ids = [parse(a.text).task_id, parse(b.text).task_id]
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain("t1")
    expect(ids).toContain("t3")
  })

  test("a dependent task is withheld while its dependency is in flight, and WAIT is not an error", async () => {
    const deps = makeDeps()
    await claimTrackingTask(deps, {})
    await claimTrackingTask(deps, {})
    const third = await claimTrackingTask(deps, {})
    expect(third.isError).toBe(false)
    expect(parse(third.text)).toMatchObject({ status: "WAIT" })
  })

  test("a lease whose run has died is reclaimed rather than stalling the loop", async () => {
    const deps = makeDeps()
    const first = await claimTrackingTask(deps, {})
    const claimId = String(parse(first.text).claim_id)
    await bindClaimToRun(deps, { claimId, runId: "run-dead" })

    const reclaimed = await claimTrackingTask(deps, {})
    const body = parse(reclaimed.text)
    expect(body.status).toBe("claimed")
    expect(body.task_id).toBe("t1")
    expect(String(body.note)).toContain("no longer running")
  })

  test("a lease whose run is alive is left alone", async () => {
    const deps = makeDeps({ alive: ["run-live"] })
    const first = await claimTrackingTask(deps, {})
    await bindClaimToRun(deps, { claimId: String(parse(first.text).claim_id), runId: "run-live" })

    const second = await claimTrackingTask(deps, {})
    expect(parse(second.text).task_id).toBe("t3")
  })

  test("a queue whose only task names the loop workdir is refused, not run", async () => {
    const deps = makeDeps({
      content: ["## Task queue", "", "- [ ] t1 Risky | worktree: .", ""].join("\n"),
    })
    const result = await claimTrackingTask(deps, {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain("QUEUE BLOCKED")
  })

  test("a dependency cycle reports QUEUE BLOCKED with the cycle named", async () => {
    const deps = makeDeps({
      content: [
        "## Task queue",
        "",
        "- [ ] t1 A | needs: t2 | worktree: ../w1",
        "- [ ] t2 B | needs: t1 | worktree: ../w2",
        "",
      ].join("\n"),
    })
    const result = await claimTrackingTask(deps, {})
    const body = parse(result.text)
    expect(body.status).toBe("QUEUE BLOCKED")
    expect(String(body.detail)).toContain("cycle")
  })

  test("an exhausted queue is reported so the orchestrator can check for GOAL MET", async () => {
    const deps = makeDeps({
      content: ["## Task queue", "", "- [x] t1 Done | worktree: ../w1", ""].join("\n"),
    })
    expect(parse((await claimTrackingTask(deps, {})).text).status).toBe("exhausted")
  })
})

describe("complete_tracking_task", () => {
  test("done settles the lease and frees its worktree", async () => {
    const deps = makeDeps()
    const claimed = await claimTrackingTask(deps, {})
    const settled = await completeTrackingTask(deps, {
      claim_id: String(parse(claimed.text).claim_id),
      outcome: "done",
    })
    expect(settled.isError).toBe(false)
    expect(settled.text).toContain("t1 marked done")

    const next = await claimTrackingTask(deps, {})
    expect(parse(next.text).task_id).toBe("t2")
  })

  test("release returns the task so the work is retried, not lost", async () => {
    const deps = makeDeps()
    const claimed = await claimTrackingTask(deps, {})
    await completeTrackingTask(deps, {
      claim_id: String(parse(claimed.text).claim_id),
      outcome: "release",
    })
    const again = await claimTrackingTask(deps, {})
    expect(parse(again.text).task_id).toBe("t1")
  })

  test("an unknown claim id is an error the worker can act on", async () => {
    const deps = makeDeps()
    const result = await completeTrackingTask(deps, { claim_id: "nope", outcome: "done" })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("no task")
  })
})
