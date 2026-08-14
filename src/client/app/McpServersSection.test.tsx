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
  onStartMcpOAuth: async (_id: string) => ({ ok: false as const, error: "noop" }),
  onCompleteMcpOAuth: async (_id: string, _callbackUrl: string) => ({ ok: false as const, error: "noop" }),
}

function stdio(
  name: string,
  status: McpServerConfig["lastTest"]["status"] = "untested",
): McpServerConfig {
  let lastTest: McpServerConfig["lastTest"]
  if (status === "ok") {
    lastTest = { status: "ok", testedAt: "", toolCount: 3 }
  } else if (status === "error") {
    lastTest = { status: "error", testedAt: "", message: "boom" }
  } else if (status === "pending") {
    lastTest = { status: "pending", startedAt: "" }
  } else {
    lastTest = { status: "untested" }
  }
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
): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<McpServersSection {...props} />)
  })
  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}

const listProps = {
  editing: { kind: "list" } as const,
  onSelect: () => {},
  onStartCreate: () => {},
  onCancelEditing: () => {},
}

function clickText(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text)
  expect(button).toBeDefined()
  return act(async () => {
    button!.click()
  })
}

function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
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
    await cleanup()
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
    await cleanup()
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
    await cleanup()
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
    await cleanup()
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
    await cleanup()
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
    await cleanup()
  })
})

function httpServer(id: string, oauth?: import("../../shared/types").McpOAuthState): McpServerConfig {
  return {
    id,
    name: id,
    enabled: true,
    createdAt: "",
    updatedAt: "",
    lastTest: { status: "untested" },
    transport: "http",
    url: "https://example.com/mcp",
    headers: {},
    ...(oauth !== undefined ? { oauth } : {}),
  }
}

describe("McpServersSection — OAuth controls", () => {
  test("editor shows Authenticate button for http server with oauth enabled+unauthenticated", async () => {
    const server = httpServer("design", { enabled: true, status: "unauthenticated" })
    const { container, cleanup } = await mount({
      servers: [server],
      editing: { kind: "edit", id: "design" },
      onSelect: () => {},
      onStartCreate: () => {},
      onCancelEditing: () => {},
      handlers: noopHandlers,
    })
    const buttons = Array.from(container.querySelectorAll("button"))
    expect(buttons.some((b) => b.textContent?.includes("Authenticate"))).toBe(true)
    await cleanup()
  })

  test("clicking Authenticate calls onStartMcpOAuth with server id", async () => {
    const calledIds: string[] = []
    const server = httpServer("design", { enabled: true, status: "unauthenticated" })
    const { container, cleanup } = await mount({
      servers: [server],
      editing: { kind: "edit", id: "design" },
      onSelect: () => {},
      onStartCreate: () => {},
      onCancelEditing: () => {},
      handlers: {
        ...noopHandlers,
        onStartMcpOAuth: async (id: string) => { calledIds.push(id); return { ok: false, error: "test" } },
      },
    })
    const buttons = Array.from(container.querySelectorAll("button"))
    const authBtn = buttons.find((b) => b.textContent?.includes("Authenticate"))
    expect(authBtn).toBeDefined()
    await act(async () => { authBtn!.click() })
    expect(calledIds).toEqual(["design"])
    await cleanup()
  })
})

describe("McpServersSection — row actions", () => {
  test("edit and delete are addressable by the server name", async () => {
    const selected: string[] = []
    const { container, cleanup } = await mount({
      ...listProps,
      servers: [stdio("fs")],
      onSelect: (id) => { selected.push(id) },
      handlers: noopHandlers,
    })

    const edit = container.querySelector<HTMLButtonElement>('[aria-label="Edit fs"]')
    expect(edit).not.toBeNull()
    expect(container.querySelector('[aria-label="Delete fs"]')).not.toBeNull()

    await act(async () => {
      edit!.click()
    })
    expect(selected).toEqual(["fs"])
    await cleanup()
  })

  test("delete asks for confirmation before calling onDelete", async () => {
    const originalConfirm = window.confirm
    const deleted: string[] = []
    const props = {
      ...listProps,
      servers: [stdio("fs")],
      handlers: { ...noopHandlers, onDelete: async (id: string) => { deleted.push(id) } },
    }

    window.confirm = () => false
    const declined = await mount(props)
    await act(async () => {
      declined.container.querySelector<HTMLButtonElement>('[aria-label="Delete fs"]')!.click()
    })
    expect(deleted).toEqual([])
    await declined.cleanup()

    window.confirm = () => true
    const accepted = await mount(props)
    await act(async () => {
      accepted.container.querySelector<HTMLButtonElement>('[aria-label="Delete fs"]')!.click()
    })
    expect(deleted).toEqual(["fs"])
    await accepted.cleanup()

    window.confirm = originalConfirm
  })
})

describe("McpServersSection — editor submit", () => {
  test("create submits the stdio input and leaves the editor", async () => {
    const created: unknown[] = []
    const cancelled: string[] = []
    const { container, cleanup } = await mount({
      ...listProps,
      servers: [],
      editing: { kind: "create" },
      onCancelEditing: () => { cancelled.push("done") },
      handlers: { ...noopHandlers, onCreate: async (input) => { created.push(input) } },
    })

    await act(async () => {
      type(container.querySelector<HTMLInputElement>('input[placeholder="fs"]')!, "fs")
      type(
        container.querySelector<HTMLInputElement>(
          'input[placeholder="/usr/local/bin/mcp-filesystem"]',
        )!,
        "/bin/ls",
      )
    })

    await clickText(container, "Add server")

    expect(created).toEqual([
      { name: "fs", transport: "stdio", command: "/bin/ls", args: [], env: {}, cwd: undefined },
    ])
    expect(cancelled).toEqual(["done"])
    await cleanup()
  })

  test("a failing save surfaces the error and stays in the editor", async () => {
    const { container, cleanup } = await mount({
      ...listProps,
      servers: [],
      editing: { kind: "create" },
      handlers: { ...noopHandlers, onCreate: async () => { throw new Error("port in use") } },
    })

    await act(async () => {
      type(container.querySelector<HTMLInputElement>('input[placeholder="fs"]')!, "fs")
    })
    await clickText(container, "Add server")

    expect(container.textContent).toContain("port in use")
    expect(container.textContent).toContain("Add MCP server")
    await cleanup()
  })

  test("an invalid name blocks submit and explains why", async () => {
    const created: unknown[] = []
    const { container, cleanup } = await mount({
      ...listProps,
      servers: [],
      editing: { kind: "create" },
      handlers: { ...noopHandlers, onCreate: async (input) => { created.push(input) } },
    })

    await act(async () => {
      type(container.querySelector<HTMLInputElement>('input[placeholder="fs"]')!, "kanna")
    })

    expect(container.textContent).toContain("'kanna' is reserved.")
    const submit = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add server")
    expect(submit!.disabled).toBe(true)
    expect(created).toEqual([])
    await cleanup()
  })
})
