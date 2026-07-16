import { describe, expect, test } from "bun:test"
import { buildLoopProgress, deriveChunkLabel } from "./loop-progress"
import type { SubagentRunSnapshot } from "./types"

function run(overrides: Partial<SubagentRunSnapshot>): SubagentRunSnapshot {
  return {
    runId: "run-1",
    chatId: "c1",
    subagentId: "sa-1",
    subagentName: "subagent-general",
    label: null,
    provider: "claude",
    model: "claude-sonnet-4-6",
    status: "running",
    parentUserMessageId: "m1",
    parentRunId: null,
    depth: 0,
    startedAt: 1_000,
    finishedAt: null,
    finalText: null,
    error: null,
    usage: null,
    entries: [],
    pendingTool: null,
    ...overrides,
  }
}

describe("deriveChunkLabel", () => {
  test("first non-blank line, trimmed", () => {
    expect(deriveChunkLabel("\n\n  Migrate useKannaState.ts  \nmore detail")).toBe(
      "Migrate useKannaState.ts",
    )
  })

  test("strips a single leading markdown marker", () => {
    expect(deriveChunkLabel("- Fix Dockerfiles for Berry")).toBe("Fix Dockerfiles for Berry")
    expect(deriveChunkLabel("## Build + start full stack")).toBe("Build + start full stack")
    expect(deriveChunkLabel("3. Verify service health")).toBe("Verify service health")
    expect(deriveChunkLabel("> quoted chunk")).toBe("quoted chunk")
  })

  test("does not mistake mid-line content for a marker", () => {
    expect(deriveChunkLabel("3D rendering pipeline")).toBe("3D rendering pipeline")
  })

  test("caps overlong labels with an ellipsis", () => {
    const long = "x".repeat(200)
    const label = deriveChunkLabel(long)
    expect(label.length).toBe(80)
    expect(label.endsWith("…")).toBe(true)
  })

  test("empty prompt → empty string", () => {
    expect(deriveChunkLabel("   \n  ")).toBe("")
  })
})

describe("buildLoopProgress", () => {
  test("maps run status → row status and prefers label over subagentName", () => {
    const snapshot = buildLoopProgress({
      chatId: "c1",
      armed: true,
      loopArmedAt: 0,
      rateLimit: null,
      runs: [
        run({ runId: "r1", status: "completed", label: "chunk one", startedAt: 10, finishedAt: 20 }),
        run({ runId: "r2", status: "running", label: null, subagentName: "worker", startedAt: 30 }),
        run({ runId: "r3", status: "failed", label: "chunk three", startedAt: 40 }),
      ],
    })
    expect(snapshot.rows.map((r) => [r.runId, r.status, r.label])).toEqual([
      ["r3", "failed", "chunk three"],
      ["r2", "running", "worker"], // label fallback to subagentName
      ["r1", "done", "chunk one"],
    ])
  })

  test("excludes nested sub-spawns and runs started before the loop armed", () => {
    const snapshot = buildLoopProgress({
      chatId: "c1",
      armed: true,
      loopArmedAt: 100,
      rateLimit: null,
      runs: [
        run({ runId: "pre", startedAt: 50 }), // before arm → excluded
        run({ runId: "nested", startedAt: 150, depth: 1 }), // sub-spawn → excluded
        run({ runId: "keep", startedAt: 200 }),
      ],
    })
    expect(snapshot.rows.map((r) => r.runId)).toEqual(["keep"])
  })

  test("passes rate-limit through and reflects armed flag", () => {
    const snapshot = buildLoopProgress({
      chatId: "c1",
      armed: false,
      loopArmedAt: null,
      rateLimit: { scheduleId: "s1", resetAt: 123, tz: "Asia/Saigon", scheduled: false },
      runs: [],
    })
    expect(snapshot.armed).toBe(false)
    expect(snapshot.rateLimit).toEqual({ scheduleId: "s1", resetAt: 123, tz: "Asia/Saigon", scheduled: false })
    expect(snapshot.rows).toEqual([])
  })
})
