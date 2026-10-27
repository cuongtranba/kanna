import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import type { McpPollSource, McpSourceStatus } from "../../shared/mcp-sources/types"
import type { McpServerConfig } from "../../shared/types"
import { useMcpSourcesSectionStore } from "../stores/mcpSourcesSectionStore"
import { McpSourcesSection, type McpSourcesSectionHandlers } from "./McpSourcesSection"

const SERVER: McpServerConfig = {
  id: "srv",
  name: "zalo-mcp",
  enabled: true,
  transport: "http",
  url: "http://127.0.0.1:3847/mcp",
  headers: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastTest: { status: "untested" },
}

const SOURCE: McpPollSource = {
  id: "s1",
  name: "Zalo",
  mode: "poll",
  serverId: "srv",
  enabled: true,
  threadKeyPath: "threadId",
  senderPath: "senderName",
  handler: { mode: "spawn", projectId: "p1", template: "t", replyHint: "", pushEnabled: true },
  tool: "zalo_get_messages",
  args: {},
  cursorArg: "since",
  cursorPath: "cursor",
  itemsPath: "messages",
  itemKeyPath: "messageId",
  intervalMs: 15000,
  createdAt: 1,
  updatedAt: 1,
}

const STATUS: McpSourceStatus = { id: "s1", state: "polling", lastError: null, lastItemAt: null, itemCount: 4 }
const SIDEBAR = { starredProjectGroups: [], projectGroups: [], stacks: [] }

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  useMcpSourcesSectionStore.setState({ editing: { kind: "list" }, confirmingDeleteId: null, error: null })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

function createHandlers() {
  const calls: string[] = []
  const handlers: McpSourcesSectionHandlers = {
    onCreate: async () => { calls.push("create") },
    onUpdate: async () => { calls.push("update") },
    onDelete: async (id) => { calls.push(`delete:${id}`) },
    onSetEnabled: async (id, enabled) => { calls.push(`enabled:${id}:${enabled}`) },
  }
  return { calls, handlers }
}

async function mount(statuses: readonly McpSourceStatus[], handlers: McpSourcesSectionHandlers): Promise<HTMLElement> {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<McpSourcesSection sources={[SOURCE]} statuses={statuses} servers={[SERVER]} sidebarData={SIDEBAR} handlers={handlers} />)
  })
  return container
}

async function click(host: HTMLElement, label: string): Promise<void> {
  const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label))
  expect(button, label).toBeDefined()
  await act(async () => {
    button!.click()
  })
}

describe("McpSourcesSection", () => {
  test("a row names its server, mode, live state and item count, and surfaces the last error", async () => {
    const { handlers } = createHandlers()
    const host = await mount([{ ...STATUS, state: "backoff", lastError: "connection dropped" }], handlers)

    expect(host.textContent).toContain("zalo-mcp · Poll")
    expect(host.textContent).toContain("Retrying")
    expect(host.textContent).toContain("4 items")
    expect(host.textContent).toContain("connection dropped")
  })

  test("Disable sends setEnabled for that source", async () => {
    const { handlers, calls } = createHandlers()
    const host = await mount([STATUS], handlers)

    await click(host, "Disable")

    expect(calls).toEqual(["enabled:s1:false"])
  })

  test("Delete asks first and removes only after the confirmation", async () => {
    const { handlers, calls } = createHandlers()
    const host = await mount([STATUS], handlers)

    await click(host, "Delete")
    expect(calls).toEqual([])
    await click(host, "Delete Zalo?")

    expect(calls).toEqual(["delete:s1"])
  })

  test("the Zalo preset fills the poll form for a new source", async () => {
    const { handlers } = createHandlers()
    const host = await mount([STATUS], handlers)

    await click(host, "Add source")
    await click(host, "Zalo preset")

    expect(host.querySelector<HTMLInputElement>("#mcp-source-tool")?.value).toBe("zalo_get_messages")
    expect(host.querySelector<HTMLInputElement>("#mcp-source-interval")?.value).toBe("15")
  })

  test("mounting the section does not loop", async () => {
    const { handlers } = createHandlers()
    const result = await renderForLoopCheck(
      <McpSourcesSection sources={[SOURCE]} statuses={[STATUS]} servers={[SERVER]} sidebarData={SIDEBAR} handlers={handlers} />,
    )
    expect(result.loopWarnings).toEqual([])
    expect(result.thrown).toBeNull()
    await result.cleanup()
  })
})
