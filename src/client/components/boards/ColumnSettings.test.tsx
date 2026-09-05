import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { ColumnSettings, type ColumnSettingsValue } from "./ColumnSettings"
import { useColumnSettingsStore } from "./ColumnSettings.store"

const VALUE: ColumnSettingsValue = {
  title: "Doing",
  semantic: "active",
  colorToken: "warning",
  wipLimit: 3,
}

interface Harness {
  saved: Array<{ columnId: string; patch: ColumnSettingsValue }>
  deleted: string[]
  unmount: () => void
}

async function mount(value = VALUE, canDelete = true): Promise<Harness> {
  const saved: Harness["saved"] = []
  const deleted: string[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <ColumnSettings
        columnId="col-1"
        value={value}
        canDelete={canDelete}
        onSave={(columnId, patch) => saved.push({ columnId, patch })}
        onDelete={(columnId) => deleted.push(columnId)}
      />,
    )
  })
  const trigger = container.querySelector("button")
  if (!trigger) throw new Error("no trigger")
  await act(async () => {
    trigger.click()
  })
  return {
    saved,
    deleted,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function byLabelText(label: string): HTMLElement {
  const found = [...document.querySelectorAll("button, input, select")].find(
    (node) => node.getAttribute("aria-label") === label,
  )
  if (!found) throw new Error(`no element labelled "${label}"`)
  return found as HTMLElement
}

function namedButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === label)
  if (!button) throw new Error(`no "${label}" button`)
  return button
}

function typeInto(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) throw new Error(`no #${id}`)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

beforeEach(() => {
  useColumnSettingsStore.getState().close()
})

describe("ColumnSettings", () => {
  test("opens seeded from the column", async () => {
    const harness = await mount()
    expect(document.querySelector<HTMLInputElement>("#column-title-col-1")?.value).toBe("Doing")
    expect(document.querySelector<HTMLSelectElement>("#column-role-col-1")?.value).toBe("active")
    expect(document.querySelector<HTMLInputElement>("#column-wip-col-1")?.value).toBe("3")
    harness.unmount()
  })

  test("names the role by its behaviour, not the enum", async () => {
    const harness = await mount()
    expect(document.body.textContent).toContain("Start work moves a card here.")
    harness.unmount()
  })

  test("renames the column", async () => {
    const harness = await mount()
    typeInto("column-title-col-1", "In progress")
    await act(async () => {
      namedButton("Save").click()
    })
    expect(harness.saved).toEqual([
      { columnId: "col-1", patch: { ...VALUE, title: "In progress" } },
    ])
    harness.unmount()
  })

  test("an empty name cannot be saved", async () => {
    const harness = await mount()
    typeInto("column-title-col-1", "   ")
    expect(namedButton("Save").disabled).toBe(true)
    harness.unmount()
  })

  test("a WIP limit that is not a positive whole number means none", async () => {
    const harness = await mount()
    typeInto("column-wip-col-1", "0")
    expect(useColumnSettingsStore.getState().draft.wipLimit).toBeNull()
    typeInto("column-wip-col-1", "abc")
    expect(useColumnSettingsStore.getState().draft.wipLimit).toBeNull()
    typeInto("column-wip-col-1", "5")
    expect(useColumnSettingsStore.getState().draft.wipLimit).toBe(5)
    harness.unmount()
  })

  test("the dot can be cleared and set from the closed palette", async () => {
    const harness = await mount()
    await act(async () => {
      byLabelText("No dot").click()
    })
    expect(useColumnSettingsStore.getState().draft.colorToken).toBeNull()
    await act(async () => {
      byLabelText("success").click()
    })
    expect(useColumnSettingsStore.getState().draft.colorToken).toBe("success")
    harness.unmount()
  })

  test("a column holding cards cannot be deleted, and says why", async () => {
    const harness = await mount(VALUE, false)
    expect(namedButton("Delete").disabled).toBe(true)
    expect(document.body.textContent).toContain("Move or archive its cards")
    harness.unmount()
  })

  test("an empty column deletes", async () => {
    const harness = await mount()
    await act(async () => {
      namedButton("Delete").click()
    })
    expect(harness.deleted).toEqual(["col-1"])
    harness.unmount()
  })

  test("closing discards the draft", async () => {
    const harness = await mount()
    typeInto("column-title-col-1", "Scratch")
    act(() => {
      useColumnSettingsStore.getState().close()
    })
    expect(useColumnSettingsStore.getState().draft.title).toBe("")
    expect(harness.saved).toEqual([])
    harness.unmount()
  })
})
