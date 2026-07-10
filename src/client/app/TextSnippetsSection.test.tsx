import { test, expect, describe } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { TextSnippetsSection, type TextSnippetsSectionHandlers } from "./TextSnippetsSection"
import type { TextSnippet } from "../../shared/types"

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
  await act(async () => {
    createRoot(container).render(<TextSnippetsSection {...props} />)
  })
  return { container, cleanup: () => container.remove() }
}

describe("TextSnippetsSection — empty state", () => {
  test("shows the empty placeholder", async () => {
    const { container, cleanup } = await mount({ snippets: [], handlers: noopHandlers })
    expect(container.textContent).toContain("No snippets yet")
    cleanup()
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
    cleanup()
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
    cleanup()
  })
})

describe("TextSnippetsSection — editor", () => {
  test("create form submits shortcut + expansion", async () => {
    const created: Array<{ shortcut: string; expansion: string }> = []
    const { container, cleanup } = await mount({
      snippets: [],
      handlers: { ...noopHandlers, onCreate: async (input) => { created.push(input) } },
    })

    // Open the create form.
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

    // In editor mode the list header button is gone; the only "Add snippet"
    // button is the form submit.
    const submit = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Add snippet",
    )
    expect(submit).not.toBeNull()
    expect(submit!.disabled).toBe(false)
    await act(async () => {
      submit!.click()
    })

    expect(created).toEqual([{ shortcut: "pgm", expansion: "pull request green then merge" }])
    cleanup()
  })
})

// happy-dom controlled-input helper: set value via the native setter so React's
// onChange fires.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
  setter?.call(el, value)
}
