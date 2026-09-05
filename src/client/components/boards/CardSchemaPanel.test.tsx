import { describe, expect, test, beforeEach } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { CardSchemaPanel, type CardSchemaPanelSocket } from "./CardSchemaPanel"
import { useCardSchemaStore } from "./CardSchemaPanel.store"
import type { FieldDef } from "../../../shared/boards/types"
import type { ClientCommand } from "../../../shared/protocol"

const FIELDS: readonly FieldDef[] = [
  { id: "description", label: "Description", kind: "longtext", options: null, required: false },
  {
    id: "priority",
    label: "Priority",
    kind: "select",
    required: false,
    options: [{ id: "high", label: "High", colorToken: "warning" }],
  },
]

interface Harness {
  container: HTMLDivElement
  commands: ClientCommand[]
  closed: () => number
  unmount: () => void
}

async function mount(fields: readonly FieldDef[] = FIELDS, fail?: string): Promise<Harness> {
  const commands: ClientCommand[] = []
  let closes = 0
  const socket: CardSchemaPanelSocket = {
    command: <TResult,>(command: ClientCommand) => {
      commands.push(command)
      return fail ? Promise.reject(new Error(fail)) : (Promise.resolve(undefined) as Promise<TResult>)
    },
  }

  useCardSchemaStore.getState().open(fields)

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <CardSchemaPanel
        boardId="board-1"
        socket={socket}
        onClose={() => {
          closes += 1
        }}
      />,
    )
  })
  return {
    container,
    commands,
    closed: () => closes,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function byLabel(container: HTMLElement, label: string): HTMLElement {
  const found = container.querySelector(`[aria-label="${label}"]`)
  if (!(found instanceof HTMLElement)) throw new Error(`no element labelled ${label}`)
  return found
}

function buttonSaying(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  )
  if (!found) throw new Error(`no button saying ${text}`)
  return found
}

async function type(input: HTMLElement, value: string) {
  if (!(input instanceof HTMLInputElement)) throw new Error("not an input")
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function savedFields(commands: ClientCommand[]): FieldDef[] | null {
  const update = commands.find((command) => (command as { type?: string }).type === "board.update")
  return (update as { cardFields?: FieldDef[] } | undefined)?.cardFields ?? null
}

beforeEach(() => {
  useCardSchemaStore.getState().open([])
})

describe("CardSchemaPanel", () => {
  test("lists the board's fields with the id and kind each one is", async () => {
    const harness = await mount()
    const text = harness.container.textContent ?? ""
    expect(text).toContain("description")
    expect(text).toContain("Long text")
    expect(text).toContain("Single choice")
    harness.unmount()
  })

  test("says a title-only board has no fields rather than showing an empty list", async () => {
    const harness = await mount([])
    expect(harness.container.textContent).toContain("title-only")
    harness.unmount()
  })

  test("adds a field and saves the whole schema, not a delta", async () => {
    const harness = await mount()
    await type(byLabel(harness.container, "New field name"), "Story points")

    const kind = byLabel(harness.container, "New field kind")
    if (!(kind instanceof HTMLSelectElement)) throw new Error("not a select")
    await act(async () => {
      kind.value = "number"
      kind.dispatchEvent(new Event("change", { bubbles: true }))
    })

    await click(buttonSaying(harness.container, "Add field"))
    await click(buttonSaying(harness.container, "Save"))

    expect(savedFields(harness.commands)).toEqual([
      ...FIELDS,
      { id: "storyPoints", label: "Story points", kind: "number", options: null, required: false },
    ] as FieldDef[])
    expect(harness.closed()).toBe(1)
    harness.unmount()
  })

  test("renaming a field changes its label and keeps its id", async () => {
    const harness = await mount()
    await type(byLabel(harness.container, "Name of the description field"), "Summary")
    await click(buttonSaying(harness.container, "Save"))

    expect(savedFields(harness.commands)?.[0]).toEqual({
      id: "description",
      label: "Summary",
      kind: "longtext",
      options: null,
      required: false,
    })
    harness.unmount()
  })

  test("required is a toggle, and saving carries it", async () => {
    const harness = await mount()
    await click(byLabel(harness.container, "Description is required"))
    await click(buttonSaying(harness.container, "Save"))
    expect(savedFields(harness.commands)?.[0]?.required).toBe(true)
    harness.unmount()
  })

  test("reordering changes the order the drawer renders", async () => {
    const harness = await mount()
    await click(byLabel(harness.container, "Move Priority up"))
    await click(buttonSaying(harness.container, "Save"))
    expect(savedFields(harness.commands)?.map((field) => field.id)).toEqual(["priority", "description"])
    harness.unmount()
  })

  test("removing warns about a field the rest of Kanna reads, and still allows it", async () => {
    const harness = await mount()
    await click(byLabel(harness.container, "Remove Description"))

    const warning = harness.container.textContent ?? ""
    expect(warning).toContain("GitHub sync")
    expect(warning).toContain("Start work")

    await click(buttonSaying(harness.container, "Remove"))
    await click(buttonSaying(harness.container, "Save"))
    expect(savedFields(harness.commands)?.map((field) => field.id)).toEqual(["priority"])
    harness.unmount()
  })

  test("removal can be backed out of", async () => {
    const harness = await mount()
    await click(byLabel(harness.container, "Remove Priority"))
    await click(buttonSaying(harness.container, "Keep"))
    await click(buttonSaying(harness.container, "Save"))
    expect(savedFields(harness.commands)?.map((field) => field.id)).toEqual(["description", "priority"])
    harness.unmount()
  })

  test("a field the rest of Kanna reads is named while it is absent, not only while it is removed", async () => {
    const harness = await mount([])
    expect(harness.container.textContent).toContain("description")
    harness.unmount()
  })

  test("manages a choice field's options, colour included", async () => {
    const harness = await mount()
    await type(byLabel(harness.container, "New option for Priority"), "Low")
    await click(buttonSaying(harness.container, "Add option"))
    await click(byLabel(harness.container, "Colour low success"))
    await click(buttonSaying(harness.container, "Save"))

    expect(savedFields(harness.commands)?.[1]?.options).toEqual([
      { id: "high", label: "High", colorToken: "warning" },
      { id: "low", label: "Low", colorToken: "success" },
    ])
    harness.unmount()
  })

  test("an option id survives a rename, the same way a field id does", async () => {
    const harness = await mount()
    await type(byLabel(harness.container, "Name of the high option"), "Critical")
    await click(buttonSaying(harness.container, "Save"))
    expect(savedFields(harness.commands)?.[1]?.options?.[0]).toEqual({
      id: "high",
      label: "Critical",
      colorToken: "warning",
    })
    harness.unmount()
  })

  test("removing an option leaves the rest alone", async () => {
    const harness = await mount()
    await click(byLabel(harness.container, "Remove option High"))
    await click(buttonSaying(harness.container, "Save"))
    expect(savedFields(harness.commands)?.[1]?.options).toEqual([])
    harness.unmount()
  })

  test("only a choice field offers options", async () => {
    const harness = await mount()
    expect(harness.container.querySelector('[aria-label="New option for Description"]')).toBeNull()
    harness.unmount()
  })

  test("closing discards the draft rather than saving it", async () => {
    const harness = await mount()
    await type(byLabel(harness.container, "Name of the description field"), "Summary")
    await click(byLabel(harness.container, "Close card fields"))
    expect(harness.commands).toEqual([])
    expect(harness.closed()).toBe(1)
    harness.unmount()
  })

  test("a refusal is shown on the panel and the draft is kept", async () => {
    const harness = await mount(FIELDS, "Those card fields are not usable.")
    await click(buttonSaying(harness.container, "Save"))
    expect(harness.container.textContent).toContain("not usable")
    expect(harness.closed()).toBe(0)
    harness.unmount()
  })
})
