// src/server/orchestration-e2e.test.ts
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import { runGit } from "./diff-store"
import { OrchestrationQueue, type StartWorker } from "./orchestration-queue"
import { createOrchWorktreeOps } from "./orchestration-worktree.adapter"
import type { OrchRunConfig } from "../shared/orchestration-types"

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-e2e-"))
  await runGit(["init", "-b", "main"], dir)
  await runGit(["config", "user.email", "test@kanna.local"], dir)
  await runGit(["config", "user.name", "kanna-test"], dir)
  writeFileSync(path.join(dir, "README.md"), "e2e\n")
  await runGit(["add", "README.md"], dir)
  await runGit(["commit", "-m", "init"], dir)
  return dir
}

describe("orchestration e2e (real worktrees, fake workers)", () => {
  test("4 tasks, 3 phases, isolated worktrees, all committed, full event trail", async () => {
    const repo = await makeRepo()
    const storeDir = mkdtempSync(path.join(tmpdir(), "kanna-orch-e2e-store-"))
    const store = new EventStore(storeDir)
    await store.initialize()

    const cwdsSeen = new Set<string>()
    const startWorker: StartWorker = async (args) => {
      cwdsSeen.add(args.cwd)
      if (args.phase.kind === "implement") {
        writeFileSync(path.join(args.cwd, `${args.taskId}.txt`), `work for ${args.taskId}\n`)
      }
      return { kind: "completed", text: `${args.phase.name} ok` }
    }

    const config: OrchRunConfig = {
      title: "e2e",
      repoRoot: repo,
      baseBranch: "main",
      maxParallelTasks: 4,
      worktreePoolSize: 4,
      maxAttempts: 3,
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "review", kind: "review", parallel: 2, promptTemplate: "REVIEW {{DIFF}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
      ],
      gates: [],
      contextPrompt: null,
      verify: null,
      init: null,
    }
    const q = new OrchestrationQueue({ store, worktrees: createOrchWorktreeOps(), startWorker })
    const runId = await q.createRun(config, [
      { id: "t1", title: "one", prompt: "do one" },
      { id: "t2", title: "two", prompt: "do two" },
      { id: "t3", title: "three", prompt: "do three" },
      { id: "t4", title: "four", prompt: "do four" },
    ])
    await q.waitForRun(runId)

    const run = store.getOrchRun(runId)!
    expect(run.status).toBe("completed")
    expect(run.tasks.map((t) => t.state)).toEqual(["committed", "committed", "committed", "committed"])
    expect(run.worktrees).toHaveLength(4)
    expect(cwdsSeen.size).toBe(4)
    for (const task of run.tasks) {
      expect(task.commitSha).toMatch(/^[0-9a-f]{7,40}$/)
      const show = await runGit(["show", "--stat", task.commitSha!], repo)
      expect(show.stdout).toContain(`${task.taskId}.txt`)
    }
    // F14: worktrees survive run completion
    for (const slot of run.worktrees) {
      expect(existsSync(path.join(slot.path, ".git"))).toBe(true)
    }
    // AG3: full event trail on disk
    await store.flush()
    const log = await Bun.file(path.join(storeDir, "orch.jsonl")).text()
    const types = log.trim().split("\n").map((l) => (JSON.parse(l) as { type: string }).type)
    expect(types.filter((t) => t === "orch_worktree_provisioned")).toHaveLength(4)
    expect(types.filter((t) => t === "orch_task_claimed")).toHaveLength(4)
    expect(types.filter((t) => t === "orch_phase_started")).toHaveLength(12) // 4 tasks x 3 phases (review=2 workers but 1 phase_started per task)
    expect(types.filter((t) => t === "orch_task_committed")).toHaveLength(4)
    expect(types.at(-1)).toBe("orch_run_completed")
  }, 60_000)
})
