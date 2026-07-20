import "../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { act } from "react"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { LoopProgressSection } from "./LoopProgressSection"
import type { LoopProgressSnapshot } from "../../shared/types"

function snapshot(overrides: Partial<LoopProgressSnapshot> = {}): LoopProgressSnapshot {
  return {
    chatId: "c1",
    armed: true,
    rows: [
      { runId: "r2", label: "Migrate useKannaState.ts", status: "running", startedAt: 20, finishedAt: null },
      { runId: "r1", label: "Add ports/adapters seal", status: "done", startedAt: 10, finishedAt: 15 },
    ],
    rateLimit: null,
    ...overrides,
  }
}

describe("LoopProgressSection", () => {
  test("renders chunk labels without a render loop", async () => {
    const result = await renderForLoopCheck(<LoopProgressSection loopProgress={snapshot()} />)
    try {
      expect(result.loopWarnings).toEqual([])
      const text = document.body.textContent ?? ""
      expect(text).toContain("Progress")
      expect(text).toContain("Migrate useKannaState.ts")
      expect(text).toContain("Add ports/adapters seal")
    } finally {
      await result.cleanup()
    }
  })

  test("returns null when never armed and no rows", async () => {
    const result = await renderForLoopCheck(
      <LoopProgressSection loopProgress={snapshot({ armed: false, rows: [] })} />,
    )
    try {
      expect(result.loopWarnings).toEqual([])
      expect((document.body.textContent ?? "").includes("Progress")).toBe(false)
    } finally {
      await result.cleanup()
    }
  })

  test("proposed rate-limit shows a Resume action that accepts the schedule", async () => {
    const calls: Array<{ scheduleId: string }> = []
    const result = await renderForLoopCheck(
      <LoopProgressSection
        loopProgress={snapshot({
          rateLimit: { scheduleId: "sched-9", resetAt: Date.now() + 60_000, tz: "Asia/Saigon", scheduled: false },
        })}
        onResume={(scheduleId) => calls.push({ scheduleId })}
      />,
    )
    try {
      const button = [...document.body.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").includes("Resume"),
      )
      expect(button).toBeDefined()
      await act(async () => {
        button!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
      expect(calls).toEqual([{ scheduleId: "sched-9" }])
    } finally {
      await result.cleanup()
    }
  })

  test("scheduled rate-limit shows no Resume action", async () => {
    const result = await renderForLoopCheck(
      <LoopProgressSection
        loopProgress={snapshot({
          rateLimit: { scheduleId: "sched-9", resetAt: Date.now() + 60_000, tz: "Asia/Saigon", scheduled: true },
        })}
        onResume={() => {}}
      />,
    )
    try {
      const button = [...document.body.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").includes("Resume"),
      )
      expect(button).toBeUndefined()
    } finally {
      await result.cleanup()
    }
  })
})
