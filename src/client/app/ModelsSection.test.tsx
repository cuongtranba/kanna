import { test, expect, describe } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { ModelsSection, type ModelsSectionHandlers } from "./ModelsSection"
import type { CustomModelEntry } from "../../shared/types"

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
  await act(async () => {
    createRoot(container).render(<ModelsSection {...props} />)
  })
  return { container, cleanup: () => container.remove() }
}

describe("ModelsSection — empty state", () => {
  test("shows per-provider empty placeholders", async () => {
    const { container, cleanup } = await mount({ models: [], handlers: noopHandlers })
    expect(container.textContent).toContain("No Claude models configured.")
    expect(container.textContent).toContain("No Codex models configured.")
    cleanup()
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
    cleanup()
  })

  test("delete button invokes onDelete with the model id (confirmed)", async () => {
    const originalConfirm = window.confirm
    window.confirm = () => true
    const deleted: string[] = []
    const { container, cleanup } = await mount({
      models: [model({ id: "claude-opus-4-8", label: "Opus 4.8" })],
      handlers: { ...noopHandlers, onDelete: async (id) => { deleted.push(id) } },
    })
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete Opus 4.8"]')
    expect(button).not.toBeNull()
    await act(async () => {
      button!.click()
    })
    expect(deleted).toEqual(["claude-opus-4-8"])
    window.confirm = originalConfirm
    cleanup()
  })

  test("delete is a no-op when confirm is cancelled", async () => {
    const originalConfirm = window.confirm
    window.confirm = () => false
    const deleted: string[] = []
    const { container, cleanup } = await mount({
      models: [model({ id: "claude-opus-4-8", label: "Opus 4.8" })],
      handlers: { ...noopHandlers, onDelete: async (id) => { deleted.push(id) } },
    })
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Delete Opus 4.8"]')
    await act(async () => {
      button!.click()
    })
    expect(deleted).toEqual([])
    window.confirm = originalConfirm
    cleanup()
  })
})
