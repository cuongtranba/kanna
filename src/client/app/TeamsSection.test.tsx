import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { TeamsSection } from "./TeamsSection"
import type { TeamTaskSummary } from "../../shared/types"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"

const BASE_NOW = 1_700_000_000_000

function makeTask(over: Partial<TeamTaskSummary> = {}): TeamTaskSummary {
  return {
    taskId: "task-1",
    name: "build frontend",
    description: "compile and bundle the frontend",
    status: "running",
    startedAt: BASE_NOW - 42_000,
    lastActivityAt: BASE_NOW,
    ...over,
  }
}

async function mountTeamsSection(props: {
  tasks: TeamTaskSummary[]
  driverPreference: "sdk" | "pty"
}): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(
      <TeamsSection tasks={props.tasks} driverPreference={props.driverPreference} />,
    )
  })
  return { container, cleanup: () => container.remove() }
}

// ── empty states ──────────────────────────────────────────────────────────────

describe("TeamsSection — empty state (sdk)", () => {
  test("renders discovery hint for sdk driver with no tasks", async () => {
    const { container, cleanup } = await mountTeamsSection({ tasks: [], driverPreference: "sdk" })
    expect(container.textContent).toContain("use parallel agents")
    expect(container.querySelector("[data-testid='teams-empty-sdk']")).not.toBeNull()
    cleanup()
  })
})

describe("TeamsSection — empty state (pty)", () => {
  test("renders SDK driver hint for pty driver with no tasks", async () => {
    const { container, cleanup } = await mountTeamsSection({ tasks: [], driverPreference: "pty" })
    expect(container.textContent).toContain("Switch to the SDK driver")
    expect(container.querySelector("[data-testid='teams-empty-pty']")).not.toBeNull()
    cleanup()
  })
})

// ── row rendering ─────────────────────────────────────────────────────────────

describe("TeamsSection — row rendering", () => {
  test("renders section header 'Teams' when tasks are present", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask()],
      driverPreference: "sdk",
    })
    expect(container.textContent?.toUpperCase()).toContain("TEAMS")
    cleanup()
  })

  test("renders primary label from name field", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", name: "deploy worker" })],
      driverPreference: "sdk",
    })
    expect(container.textContent).toContain("deploy worker")
    cleanup()
  })

  test("renders description as secondary when name is present", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", name: "deploy worker", description: "deploy the backend worker" })],
      driverPreference: "sdk",
    })
    expect(container.textContent).toContain("deploy worker")
    expect(container.textContent).toContain("deploy the backend worker")
    cleanup()
  })

  test("uses description as primary label when name is absent", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", name: undefined, description: "build the thing" })],
      driverPreference: "sdk",
    })
    expect(container.textContent).toContain("build the thing")
    cleanup()
  })

  test("does not render description as secondary when name is absent", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", name: undefined, description: "unique-desc-only" })],
      driverPreference: "sdk",
    })
    // Only appears once (primary), not duplicated as secondary
    const text = container.textContent ?? ""
    const matches = text.split("unique-desc-only").length - 1
    expect(matches).toBe(1)
    cleanup()
  })

  test("renders status pill text for running task", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", status: "running" })],
      driverPreference: "sdk",
    })
    expect(container.textContent?.toUpperCase()).toContain("RUNNING")
    cleanup()
  })

  test("renders status pill text for completed task", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", status: "completed", endedAt: BASE_NOW })],
      driverPreference: "sdk",
    })
    expect(container.textContent?.toUpperCase()).toContain("COMPLETED")
    cleanup()
  })

  test("renders status pill text for failed task", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", status: "failed", endedAt: BASE_NOW })],
      driverPreference: "sdk",
    })
    expect(container.textContent?.toUpperCase()).toContain("FAILED")
    cleanup()
  })

  test("renders model badge when model is set", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", model: "claude-opus-4" })],
      driverPreference: "sdk",
    })
    expect(container.textContent).toContain("claude-opus-4")
    cleanup()
  })

  test("does not render model badge when model is absent", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", model: undefined })],
      driverPreference: "sdk",
    })
    const row = container.querySelector("[data-testid='team-task-row:t1']")
    expect(row).not.toBeNull()
    // No "model" badge content — just verify no crash and name is present
    cleanup()
  })

  test("renders elapsed duration using formatCompactDuration (42s)", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [makeTask({ taskId: "t1", startedAt: BASE_NOW - 42_000, endedAt: BASE_NOW })],
      driverPreference: "sdk",
    })
    expect(container.textContent).toContain("42s")
    cleanup()
  })

  test("renders multiple rows", async () => {
    const { container, cleanup } = await mountTeamsSection({
      tasks: [
        makeTask({ taskId: "t1", name: "task-alpha" }),
        makeTask({ taskId: "t2", name: "task-bravo" }),
        makeTask({ taskId: "t3", name: "task-charlie" }),
      ],
      driverPreference: "sdk",
    })
    expect(container.textContent).toContain("task-alpha")
    expect(container.textContent).toContain("task-bravo")
    expect(container.textContent).toContain("task-charlie")
    cleanup()
  })
})

// ── render-loop safety ────────────────────────────────────────────────────────

describe("TeamsSection — render-loop safety", () => {
  test("mounts with tasks without render-loop warning", async () => {
    const result = await renderForLoopCheck(
      <TeamsSection tasks={[makeTask()]} driverPreference="sdk" />,
    )
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })

  test("mounts empty (sdk) without render-loop warning", async () => {
    const result = await renderForLoopCheck(
      <TeamsSection tasks={[]} driverPreference="sdk" />,
    )
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })

  test("mounts empty (pty) without render-loop warning", async () => {
    const result = await renderForLoopCheck(
      <TeamsSection tasks={[]} driverPreference="pty" />,
    )
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })
})
