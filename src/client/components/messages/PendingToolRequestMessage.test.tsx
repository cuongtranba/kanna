import { afterEach, describe, expect, test, vi } from "vite-plus/test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import type { BeaconStatusRow } from "../../../shared/beacon-status"
import { useBeaconsStore } from "../../stores/beaconsStore"
import type { ToolRequestDecision } from "../../../shared/permission-policy"
import { PendingToolRequestMessage, type PendingToolRequestHydrated } from "./PendingToolRequestMessage"

function makeEntry(overrides: Partial<PendingToolRequestHydrated> = {}): PendingToolRequestHydrated {
  return {
    id: "pending-1",
    timestamp: new Date(1000).toISOString(),
    kind: "pending_tool_request",
    toolRequestId: "req-1",
    toolName: "mcp__kanna__expose_port",
    arguments: { port: 3000 },
    ...overrides,
  }
}


describe("PendingToolRequestMessage — generic fallback", () => {
  test("renders tool name + Allow / Deny buttons for unknown tool", async () => {
    const entry = makeEntry({
      toolName: "mcp__kanna__expose_port",
      arguments: { port: 3000 },
    })
    const onAnswer = vi.fn((_id: string, _decision: ToolRequestDecision) => Promise.resolve())
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={entry} onAnswer={onAnswer} />,
      )
    })

    expect(container.textContent).toContain("mcp__kanna__expose_port")
    expect(container.textContent).toContain("Allow")
    expect(container.textContent).toContain("Deny")
    container.remove()
  })

  test("Allow button resolves with kind:allow", async () => {
    const entry = makeEntry({
      toolName: "mcp__kanna__bash",
      arguments: { command: "echo hi" },
    })
    const onAnswer = vi.fn((_id: string, _decision: ToolRequestDecision) => Promise.resolve())
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={entry} onAnswer={onAnswer} />,
      )
    })

    const allowBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Allow")
    expect(allowBtn).toBeDefined()
    await act(async () => {
      allowBtn?.click()
    })
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer.mock.calls[0]?.[1]).toEqual({ kind: "allow" })
    container.remove()
  })

  test("Deny button resolves with kind:deny + user_canceled reason", async () => {
    const entry = makeEntry({
      toolName: "mcp__kanna__bash",
      arguments: { command: "echo hi" },
    })
    const onAnswer = vi.fn((_id: string, _decision: ToolRequestDecision) => Promise.resolve())
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <PendingToolRequestMessage entry={entry} onAnswer={onAnswer} />,
      )
    })

    const denyBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Deny")
    expect(denyBtn).toBeDefined()
    await act(async () => {
      denyBtn?.click()
    })
    expect(onAnswer.mock.calls[0]?.[1]).toEqual({ kind: "deny", reason: "user_canceled" })
    container.remove()
  })
})

describe("PendingToolRequestMessage — beacon tools", () => {
  const BEACON_ROW: BeaconStatusRow = {
    id: "b1",
    label: "Work laptop",
    alias: null,
    os: "darwin",
    enabled: true,
    online: true,
    lastSeenAt: null,
    beaconVersion: "1.0.0",
    canSelfUpdate: true,
    update: null,
  }

  function beaconEntry(toolName: string, args: PendingToolRequestHydrated["arguments"]): PendingToolRequestHydrated {
    return makeEntry({ toolName, arguments: args })
  }

  afterEach(() => {
    useBeaconsStore.getState().setRows([])
  })

  test("the consent card names the machine and shows the command that will run", async () => {
    useBeaconsStore.getState().setRows([BEACON_ROW])
    const result = await renderForLoopCheck(
      <PendingToolRequestMessage
        entry={beaconEntry("mcp__kanna__beacon_exec", { beaconId: "b1", cmd: "git", args: ["status", "-s"] })}
        onAnswer={() => Promise.resolve()}
      />,
    )
    expect(result.thrown).toBeNull()
    expect(result.loopWarnings).toEqual([])
    expect(document.body.textContent).toContain("Work laptop")
    expect(document.body.textContent).toContain("darwin")
    expect(document.body.textContent).toContain("Online")
    expect(document.body.textContent).toContain("git status -s")
    expect(document.body.textContent).toContain("Allow")
    await result.cleanup()
  })

  test("a beacon missing from the store falls back to its bare id and still shows the script body", async () => {
    const result = await renderForLoopCheck(
      <PendingToolRequestMessage
        entry={beaconEntry("mcp__kanna__beacon_script", { beaconId: "ghost-id", body: "echo hello\nrm -rf build" })}
        onAnswer={() => Promise.resolve()}
      />,
    )
    expect(result.loopWarnings).toEqual([])
    expect(document.body.textContent).toContain("ghost-id")
    expect(document.body.textContent).toContain("rm -rf build")
    await result.cleanup()
  })
})
