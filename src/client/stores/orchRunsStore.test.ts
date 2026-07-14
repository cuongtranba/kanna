import { describe, expect, test } from "bun:test"
import { selectOrchRuns, useOrchRunsStore } from "./orchRunsStore"
import type { OrchRunSummary } from "../../shared/orchestration-types"

describe("orchRunsStore", () => {
  test("selector returns a stable reference before any set", () => {
    const a = selectOrchRuns(useOrchRunsStore.getState())
    const b = selectOrchRuns(useOrchRunsStore.getState())
    expect(a).toBe(b)
    expect(a).toEqual([])
  })

  test("setRuns replaces the list", () => {
    const runs: OrchRunSummary[] = [
      { runId: "r1", title: "Run: 1 task", status: "running", counts: { total: 1, queued: 0, running: 1, committed: 0, failed: 0 }, createdAt: 1, updatedAt: 1 },
    ]
    useOrchRunsStore.getState().setRuns(runs)
    expect(selectOrchRuns(useOrchRunsStore.getState())).toBe(runs)
    useOrchRunsStore.getState().setRuns([])
  })
})
