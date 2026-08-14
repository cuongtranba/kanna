import { test, expect, describe, beforeEach } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { ModelsSection, type ModelsSectionHandlers } from "./ModelsSection"
import { useModelsSectionStore } from "../stores/modelsSectionStore"
import type { CustomModelEntry } from "../../shared/types"
import type { DomPort } from "../ports/domPort"

// The section reads `editing` from a module-singleton store, so a test that
// walks into the editor would otherwise start the next one there.
beforeEach(() => {
  useModelsSectionStore.setState({ editing: { kind: "list" } })
})

function makeDomFake(confirmResult: boolean): DomPort {
  return { confirmDialog: () => confirmResult } as unknown as DomPort
}

const noopHandlers: ModelsSectionHandlers = {
  onCreate: async () => {},
  onUpdate: async () => {},
  onDelete: async () => {},
}

function model(over: Partial<CustomModelEntry>): CustomModelEntry {
  return {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    provider: "claude",
    supportsEffort: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

async function mount(props: Parameters<typeof ModelsSection>[0]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<ModelsSection {...props} />)
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

// happy-dom controlled-input helper: set value via the native setter so React's
// onChange fires.
function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

function modelIdInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[placeholder="claude-opus-4-9"]')!
}

function labelInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[placeholder="Opus 4.9"]')!
}

describe("ModelsSection — empty state", () => {
  test("shows per-provider empty placeholders", async () => {
    const { container, cleanup } = await mount({ models: [], handlers: noopHandlers })
    expect(container.textContent).toContain("No Claude models configured.")
    expect(container.textContent).toContain("No Codex models configured.")
    await cleanup()
  })
})

describe("ModelsSection — list", () => {
  test("renders claude and codex rows with label + id", async () => {
    const { container, cleanup } = await mount({
      models: [
        model({ id: "claude-opus-4-8", label: "Opus 4.8", provider: "claude" }),
        model({ id: "gpt-5.5", label: "GPT-5.5", provider: "codex", supportsEffort: false }),
      ],
      handlers: noopHandlers,
    })
    expect(container.textContent).toContain("Opus 4.8")
    expect(container.textContent).toContain("claude-opus-4-8")
    expect(container.textContent).toContain("GPT-5.5")
    expect(container.textContent).toContain("gpt-5.5")
    await cleanup()
  })

  test("delete button invokes onDelete with the model id (confirmed)", async () => {
    const deleted: string[] = []
    const { container, cleanup } = await mount({
      models: [model({ id: "claude-opus-4-8", label: "Opus 4.8" })],
      handlers: { ...noopHandlers, onDelete: async (id) => { deleted.push(id) } },
      dom: makeDomFake(true),
    })
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete Opus 4.8"]')
    expect(button).not.toBeNull()
    await act(async () => {
      button!.click()
    })
    expect(deleted).toEqual(["claude-opus-4-8"])
    await cleanup()
  })

  test("delete is a no-op when confirm is cancelled", async () => {
    const deleted: string[] = []
    const { container, cleanup } = await mount({
      models: [model({ id: "claude-opus-4-8", label: "Opus 4.8" })],
      handlers: { ...noopHandlers, onDelete: async (id) => { deleted.push(id) } },
      dom: makeDomFake(false),
    })
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete Opus 4.8"]')
    await act(async () => {
      button!.click()
    })
    expect(deleted).toEqual([])
    await cleanup()
  })
})

describe("ModelsSection — editor", () => {
  test("create submits trimmed id + label and returns to the list", async () => {
    const created: unknown[] = []
    const { container, cleanup } = await mount({
      models: [],
      handlers: { ...noopHandlers, onCreate: async (input) => { created.push(input) } },
    })

    // Two "Add model" buttons in list mode (claude, codex); the first is claude.
    const addButtons = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.includes("Add model"),
    )
    expect(addButtons).toHaveLength(2)
    await act(async () => {
      addButtons[0]!.click()
    })

    await act(async () => {
      type(modelIdInput(container), "  claude-opus-4-9  ")
      type(labelInput(container), "  Opus 4.9  ")
    })

    await clickText(container, "Add model")

    expect(created).toEqual([
      { id: "claude-opus-4-9", label: "Opus 4.9", provider: "claude", supportsEffort: false },
    ])
    // onDone ran, so the list (both per-provider Add buttons) is back.
    expect(
      [...container.querySelectorAll("button")].filter((b) => b.textContent?.includes("Add model")),
    ).toHaveLength(2)
    await cleanup()
  })

  test("duplicate id in the same provider blocks save", async () => {
    const { container, cleanup } = await mount({
      models: [model({ id: "claude-opus-4-8", provider: "claude" })],
      handlers: noopHandlers,
    })
    const addButtons = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.includes("Add model"),
    )
    await act(async () => {
      addButtons[0]!.click()
    })

    await act(async () => {
      type(modelIdInput(container), "claude-opus-4-8")
      type(labelInput(container), "Clash")
    })

    expect(container.textContent).toContain("A model with this id already exists.")
    const submit = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add model")
    expect(submit!.disabled).toBe(true)
    await cleanup()
  })

  test("edit submits a label patch against the existing id", async () => {
    const updates: Array<{ id: string; patch: unknown }> = []
    const { container, cleanup } = await mount({
      models: [model({ id: "claude-opus-4-8", label: "Opus 4.8", supportsEffort: true })],
      handlers: { ...noopHandlers, onUpdate: async (id, patch) => { updates.push({ id, patch }) } },
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Edit Opus 4.8"]')!.click()
    })
    expect(container.textContent).toContain("Edit model")

    await act(async () => {
      type(labelInput(container), "Opus 4.8 (fast)")
    })
    await clickText(container, "Save changes")

    expect(updates).toEqual([
      { id: "claude-opus-4-8", patch: { label: "Opus 4.8 (fast)", supportsEffort: true } },
    ])
    await cleanup()
  })

  test("a failing save surfaces the error and keeps the editor open", async () => {
    const { container, cleanup } = await mount({
      models: [],
      handlers: {
        ...noopHandlers,
        onCreate: async () => { throw new Error("server said no") },
      },
    })
    const addButtons = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.includes("Add model"),
    )
    await act(async () => {
      addButtons[0]!.click()
    })
    await act(async () => {
      type(modelIdInput(container), "gpt-5.5")
      type(labelInput(container), "GPT-5.5")
    })

    await clickText(container, "Add model")

    expect(container.textContent).toContain("server said no")
    expect(container.textContent).toContain("Add model")
    // Still submittable — `submitting` was cleared in the finally.
    const submit = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add model")
    expect(submit!.disabled).toBe(false)
    await cleanup()
  })
})
