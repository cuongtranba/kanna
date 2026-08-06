import { describe, expect, test } from "bun:test"
import { buildLoopProgress, chunkLabelFromSection, deriveChunkLabel, parseChunkMarker } from "./loop-progress"
import type { BuildLoopProgressInput, LoopTrackingSnapshot } from "./loop-progress"
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

  test("prefers the [chunk: …] marker over the boilerplate that follows it", () => {
    // The exact shape a loop delegation arrives in: one line, marker first,
    // then the identical server-rendered worker brief.
    const prompt =
      "[chunk: Wire session tabs to the store] Do the next chunk in PROGRESS-session-tabs.md."
      + " All work happens in /home/cuong/repo/kanna."
    expect(deriveChunkLabel(prompt)).toBe("Wire session tabs to the store")
  })
})

describe("parseChunkMarker", () => {
  test("reads the marker body, case-insensitively", () => {
    expect(parseChunkMarker("[chunk: Migrate ChatPage] rest")).toBe("Migrate ChatPage")
    expect(parseChunkMarker("  [CHUNK:  Trim spaces  ] rest")).toBe("Trim spaces")
  })

  test("rejects an unsubstituted placeholder so template noise never reaches the UI", () => {
    expect(parseChunkMarker("[chunk: <one-line summary of the Next chunk you just read>] rest"))
      .toBeNull()
  })

  test("null when absent, empty, or not at the head of the prompt", () => {
    expect(parseChunkMarker("Do the next chunk in PROGRESS.md.")).toBeNull()
    expect(parseChunkMarker("[chunk:   ] rest")).toBeNull()
    expect(parseChunkMarker("Prefix [chunk: too late] rest")).toBeNull()
  })

  test("caps an overlong marker body", () => {
    const label = parseChunkMarker(`[chunk: ${"x".repeat(200)}] rest`)
    expect(label?.length).toBe(80)
    expect(label?.endsWith("…")).toBe(true)
  })
})

describe("chunkLabelFromSection", () => {
  test("first line of the section body, heading dropped", () => {
    expect(chunkLabelFromSection("## Next chunk\n\nWire session tabs to the store\nDetails here"))
      .toBe("Wire session tabs to the store")
  })

  test("strips a list marker the plan wrote", () => {
    expect(chunkLabelFromSection("## Next chunk\n- Fix Dockerfiles for Berry")).toBe(
      "Fix Dockerfiles for Berry",
    )
  })

  test("empty for a finished or empty plan so the caller falls back", () => {
    expect(chunkLabelFromSection("## Next chunk\n\nDONE\n")).toBe("")
    expect(chunkLabelFromSection("## Next chunk\n\n")).toBe("")
    expect(chunkLabelFromSection("")).toBe("")
  })

  test("keeps a sub-heading that is the chunk's own first line", () => {
    expect(chunkLabelFromSection("## Next chunk\n### Stage 4: pane retention")).toBe(
      "Stage 4: pane retention",
    )
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
      ["r1", "done", "chunk one"],
      ["r2", "running", "worker"], // label fallback to subagentName
      ["r3", "failed", "chunk three"],
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

const NEXT_CHUNK = "## Next chunk\n\nStage 4: pane retention\n"

function tracked(overrides: Partial<LoopTrackingSnapshot> = {}): LoopTrackingSnapshot {
  return {
    doneEntries: [
      "- 2026-08-06 chunk three DONE",
      "- 2026-08-05 chunk two DONE",
      "- 2026-08-04 chunk one DONE",
    ],
    nextChunkSection: NEXT_CHUNK,
    ...overrides,
  }
}

function tracking(overrides: Partial<BuildLoopProgressInput> = {}): BuildLoopProgressInput {
  return {
    chatId: "c1",
    armed: true,
    loopArmedAt: 100,
    rateLimit: null,
    runs: [],
    tracking: tracked(),
    ...overrides,
  }
}

describe("buildLoopProgress with a tracking file", () => {
  test("the plan's completed chunks become done rows, oldest first, ahead of the pending step", () => {
    const rows = buildLoopProgress(tracking()).rows
    expect(rows.map((r) => [r.runId, r.status, r.label])).toEqual([
      ["progress:0", "done", "2026-08-04 chunk one DONE"],
      ["progress:1", "done", "2026-08-05 chunk two DONE"],
      ["progress:2", "done", "2026-08-06 chunk three DONE"],
      ["next", "pending", "Stage 4: pane retention"],
    ])
  })

  test("a live worker replaces the pending row and keeps its own chunk label", () => {
    const rows = buildLoopProgress(
      tracking({
        runs: [run({ runId: "r9", status: "running", label: "Stage 4a", startedAt: 200 })],
      }),
    ).rows
    expect(rows.filter((r) => r.status === "pending")).toEqual([])
    expect(rows.at(-1)).toMatchObject({ runId: "r9", status: "running", label: "Stage 4a" })
  })

  test("a completed run already recorded in the plan is not duplicated", () => {
    const rows = buildLoopProgress(
      tracking({
        tracking: tracked({ doneEntries: ["- 2026-08-04 chunk one DONE"] }),
        runs: [run({ runId: "r1", status: "completed", label: "chunk one", startedAt: 200, finishedAt: 250 })],
      }),
    ).rows
    expect(rows.map((r) => r.runId)).toEqual(["progress:0", "next"])
  })

  test("a completion the worker never recorded still shows, so the panel cannot shrink", () => {
    const rows = buildLoopProgress(
      tracking({
        tracking: tracked({ doneEntries: ["- 2026-08-04 chunk one DONE"] }),
        runs: [
          run({ runId: "r1", status: "completed", label: "chunk one", startedAt: 200, finishedAt: 250 }),
          run({ runId: "r2", status: "completed", label: "chunk two", startedAt: 300, finishedAt: 350 }),
        ],
      }),
    ).rows
    expect(rows.map((r) => [r.runId, r.status])).toEqual([
      ["progress:0", "done"],
      ["r2", "done"],
      ["next", "pending"],
    ])
  })

  test("a failed run sits between the recorded work and the current step", () => {
    const rows = buildLoopProgress(
      tracking({
        tracking: tracked({ doneEntries: ["- 2026-08-04 chunk one DONE"] }),
        runs: [
          run({ runId: "boom", status: "failed", label: "chunk two", startedAt: 200 }),
          run({ runId: "live", status: "running", label: "chunk two retry", startedAt: 300 }),
        ],
      }),
    ).rows
    expect(rows.map((r) => [r.runId, r.status])).toEqual([
      ["progress:0", "done"],
      ["boom", "failed"],
      ["live", "running"],
    ])
  })

  test("a finished plan shows no pending row", () => {
    const rows = buildLoopProgress(
      tracking({ tracking: tracked({ nextChunkSection: "## Next chunk\n\nDONE\n" }) }),
    ).rows
    expect(rows.map((r) => r.status)).toEqual(["done", "done", "done"])
  })

  test("a disarmed loop shows the recorded work without proposing a next step", () => {
    const rows = buildLoopProgress(tracking({ armed: false })).rows
    expect(rows.map((r) => r.status)).toEqual(["done", "done", "done"])
  })

  test("recording a newer chunk leaves every existing row id untouched", () => {
    const before = buildLoopProgress(tracking()).rows
    const after = buildLoopProgress(
      tracking({
        tracking: tracked({
          doneEntries: ["- 2026-08-07 chunk four DONE", ...tracked().doneEntries],
        }),
      }),
    ).rows
    expect(after.slice(0, 3).map((r) => r.runId)).toEqual(before.slice(0, 3).map((r) => r.runId))
    expect(after[3]).toMatchObject({ runId: "progress:3", label: "2026-08-07 chunk four DONE" })
  })

  test("an unreadable plan falls back to the live runs alone", () => {
    const rows = buildLoopProgress(
      tracking({
        tracking: null,
        runs: [run({ runId: "r1", status: "completed", label: "chunk one", startedAt: 200 })],
      }),
    ).rows
    expect(rows.map((r) => [r.runId, r.status])).toEqual([["r1", "done"]])
  })
})
