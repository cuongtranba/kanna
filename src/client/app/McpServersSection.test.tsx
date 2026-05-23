import { test, expect, describe } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { McpServersSection } from "./McpServersSection"
import type { McpServerConfig } from "../../shared/types"

const noopHandlers = {
  onCreate: async () => {},
  onUpdate: async () => {},
  onDelete: async () => {},
  onSetEnabled: async () => {},
  onTest: async () => {},
}

function stdio(
  name: string,
  status: McpServerConfig["lastTest"]["status"] = "untested",
): McpServerConfig {
  const lastTest: McpServerConfig["lastTest"] =
    status === "ok"
      ? { status: "ok", testedAt: "", toolCount: 3 }
      : status === "error"
        ? { status: "error", testedAt: "", message: "boom" }
        : status === "pending"
          ? { status: "pending", startedAt: "" }
          : { status: "untested" }
  return {
    id: name,
    name,
    enabled: true,
    createdAt: "",
    updatedAt: "",
    lastTest,
    transport: "stdio",
    command: "/bin/ls",
    args: [],
    env: {},
  }
}

async function mount(
  props: Parameters<typeof McpServersSection>[0],
): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(<McpServersSection {...props} />)
  })
  return { container, cleanup: () => container.remove() }
}

describe("McpServersSection — empty state", () => {
  test("renders empty state when no servers", async () => {
    const { container, cleanup } = await mount({
      servers: [],
      editing: { kind: "list" },
      onSelect: () => {},
      onStartCreate: () => {},
      onCancelEditing: () => {},
      handlers: noopHandlers,
    })
    expect(container.textContent).toContain("No custom MCP servers")
    cleanup()
  })
})

describe("McpServersSection — list", () => {
  test("renders row with name and transport badge", async () => {
    const { container, cleanup } = await mount({
      servers: [stdio("fs")],
      editing: { kind: "list" },
      onSelect: () => {},
      onStartCreate: () => {},
      onCancelEditing: () => {},
      handlers: noopHandlers,
    })
    expect(container.textContent).toContain("fs")
    expect(container.textContent?.toLowerCase()).toContain("stdio")
    cleanup()
  })

  test("renders ok pill with tool count", async () => {
    const { container, cleanup } = await mount({
      servers: [stdio("fs", "ok")],
      editing: { kind: "list" },
      onSelect: () => {},
      onStartCreate: () => {},
      onCancelEditing: () => {},
      handlers: noopHandlers,
    })
    expect(container.textContent).toContain("3 tools")
    cleanup()
  })

  test("renders failed pill when last test errored", async () => {
    const { container, cleanup } = await mount({
      servers: [stdio("fs", "error")],
      editing: { kind: "list" },
      onSelect: () => {},
      onStartCreate: () => {},
      onCancelEditing: () => {},
      handlers: noopHandlers,
    })
    expect(container.textContent).toContain("Failed")
    cleanup()
  })
})

describe("McpServersSection — editor", () => {
  test("editor opens for create with empty name heading", async () => {
    const { container, cleanup } = await mount({
      servers: [],
      editing: { kind: "create" },
      onSelect: () => {},
      onStartCreate: () => {},
      onCancelEditing: () => {},
      handlers: noopHandlers,
    })
    expect(container.textContent).toContain("Add MCP server")
    cleanup()
  })

  test("editor shows Save changes heading for edit mode", async () => {
    const { container, cleanup } = await mount({
      servers: [stdio("myserver")],
      editing: { kind: "edit", id: "myserver" },
      onSelect: () => {},
      onStartCreate: () => {},
      onCancelEditing: () => {},
      handlers: noopHandlers,
    })
    expect(container.textContent).toContain("Edit MCP server")
    cleanup()
  })
})
