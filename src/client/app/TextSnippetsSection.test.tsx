import { test, expect, describe, beforeEach } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { TextSnippetsSection, type TextSnippetsSectionHandlers } from "./TextSnippetsSection"
import { useTextSnippetsSectionStore } from "../stores/textSnippetsSectionStore"
import type { TextSnippet } from "../../shared/types"

beforeEach(() => {
  useTextSnippetsSectionStore.setState({ editing: { kind: "list" } })
})

const noopHandlers: TextSnippetsSectionHandlers = {
  onCreate: async () => {},
  onUpdate: async () => {},
  onDelete: async () => {},
}

function snippet(over: Partial<TextSnippet>): TextSnippet {
  return {
    id: "pgm-id",
    shortcut: "pgm",
    expansion: "pull request green then merge",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

async function mount(props: Parameters<typeof TextSnippetsSection>[0]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<TextSnippetsSection {...props} />)
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

function clickText(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text)
  expect(button).toBeDefined()
  return act(async () => {
    button!.click()
  })
}

function shortcutInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[placeholder="pgm"]')!
}

describe("TextSnippetsSection — empty state", () => {
  test("shows the empty placeholder", async () => {
    const { container, cleanup } = await mount({ snippets: [], handlers: noopHandlers })
    expect(container.textContent).toContain("No snippets yet")
    await cleanup()
  })
})

describe("TextSnippetsSection — list", () => {
  test("renders shortcut and expansion", async () => {
    const { container, cleanup } = await mount({
      snippets: [snippet({})],
      handlers: noopHandlers,
    })
    expect(container.textContent).toContain("pgm")
    expect(container.textContent).toContain("pull request green then merge")
    await cleanup()
  })

  test("delete invokes onDelete with the snippet id when confirmed", async () => {
    const originalConfirm = window.confirm
    window.confirm = () => true
    const deleted: string[] = []
    const { container, cleanup } = await mount({
      snippets: [snippet({})],
      handlers: { ...noopHandlers, onDelete: async (id) => { deleted.push(id) } },
    })
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete pgm"]')
    expect(button).not.toBeNull()
    await act(async () => {
      button!.click()
    })
    expect(deleted).toEqual(["pgm-id"])
    window.confirm = originalConfirm
    await cleanup()
  })
})

describe("TextSnippetsSection — editor", () => {
  test("create form submits shortcut + expansion", async () => {
    const created: Array<{ shortcut: string; expansion: string }> = []
    const { container, cleanup } = await mount({
      snippets: [],
      handlers: { ...noopHandlers, onCreate: async (input) => { created.push(input) } },
    })

    const addButton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add snippet"),
    )
    await act(async () => {
      addButton!.click()
    })

    const shortcutInput = container.querySelector<HTMLInputElement>('input[placeholder="pgm"]')
    const expansionInput = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(shortcutInput).not.toBeNull()
    expect(expansionInput).not.toBeNull()

    await act(async () => {
      setNativeValue(shortcutInput!, "pgm")
      shortcutInput!.dispatchEvent(new Event("input", { bubbles: true }))
      setNativeValue(expansionInput!, "pull request green then merge")
      expansionInput!.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const submit = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Add snippet",
    )
    expect(submit).not.toBeNull()
    expect(submit!.disabled).toBe(false)
    await act(async () => {
      submit!.click()
    })

    expect(created).toEqual([{ shortcut: "pgm", expansion: "pull request green then merge" }])
    await cleanup()
  })

  test("cancel returns to the list and clears the draft for the next create", async () => {
    const { container, cleanup } = await mount({ snippets: [], handlers: noopHandlers })

    await clickText(container, "Add snippet")
    await act(async () => {
      setNativeValue(shortcutInput(container), "abandoned")
      shortcutInput(container).dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(shortcutInput(container).value).toBe("abandoned")

    await clickText(container, "Cancel")
    expect(container.textContent).toContain("No snippets yet")

    await clickText(container, "Add snippet")
    expect(shortcutInput(container).value).toBe("")
    await cleanup()
  })

  test("edit preloads the snippet and submits an update patch", async () => {
    const updates: Array<{ id: string; patch: unknown }> = []
    const { container, cleanup } = await mount({
      snippets: [snippet({})],
      handlers: { ...noopHandlers, onUpdate: async (id, patch) => { updates.push({ id, patch }) } },
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Edit pgm"]')!.click()
    })
    expect(container.textContent).toContain("Edit snippet")
    expect(shortcutInput(container).value).toBe("pgm")

    const expansion = container.querySelector<HTMLTextAreaElement>("textarea")!
    await act(async () => {
      setNativeValue(expansion, "ship it")
      expansion.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await clickText(container, "Save changes")

    expect(updates).toEqual([{ id: "pgm-id", patch: { shortcut: "pgm", expansion: "ship it" } }])
    await cleanup()
  })

  test("a failing save surfaces the error and keeps the editor open", async () => {
    const { container, cleanup } = await mount({
      snippets: [],
      handlers: { ...noopHandlers, onCreate: async () => { throw new Error("disk full") } },
    })

    await clickText(container, "Add snippet")
    const expansion = container.querySelector<HTMLTextAreaElement>("textarea")!
    await act(async () => {
      setNativeValue(shortcutInput(container), "pgm")
      shortcutInput(container).dispatchEvent(new Event("input", { bubbles: true }))
      setNativeValue(expansion, "pull request green then merge")
      expansion.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await clickText(container, "Add snippet")

    expect(container.textContent).toContain("disk full")
    expect(container.textContent).toContain("Add snippet")
    await cleanup()
  })
})

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
  setter?.call(el, value)
}
