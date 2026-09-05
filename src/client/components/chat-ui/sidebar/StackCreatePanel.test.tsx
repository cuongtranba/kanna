import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { TooltipProvider } from "../../ui/tooltip"
import { StackCreatePanel } from "./StackCreatePanel"

const noopAsync = async () => undefined

function renderPanel(
  props: Partial<Parameters<typeof StackCreatePanel>[0]> = {},
  projects: Array<{ id: string; title: string }> = [
    { id: "p1", title: "Project A" },
    { id: "p2", title: "Project B" },
  ]
): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(StackCreatePanel, {
        mode: "create",
        projects,
        onSubmit: noopAsync,
        onCancel: () => undefined,
        ...props,
      })
    )
  )
}

describe("StackCreatePanel", () => {
  test("renders title input, project chip list, Save and Cancel buttons", () => {
    const html = renderPanel()
    expect(html).toContain("<input")
    expect(html).toContain("Project A")
    expect(html).toContain("Project B")
    expect(html).toContain("Save")
    expect(html).toContain("Cancel")
  })

  test("Save button is disabled when title is empty", () => {
    const html = renderPanel({ initialTitle: "" }, [
      { id: "p1", title: "Project A" },
      { id: "p2", title: "Project B" },
    ])
    const saveIndex = html.indexOf("Save")
    const buttonChunk = html.slice(0, saveIndex)
    const lastButtonStart = buttonChunk.lastIndexOf("<button")
    const buttonTag = html.slice(lastButtonStart, saveIndex)
    expect(buttonTag).toContain("disabled")
  })

  test("Save button is disabled when fewer than 2 projects are selected", () => {
    const html = renderPanel({ initialTitle: "My Stack", initialProjectIds: [] }, [
      { id: "p1", title: "Project A" },
      { id: "p2", title: "Project B" },
    ])
    const saveIndex = html.indexOf("Save")
    const buttonChunk = html.slice(0, saveIndex)
    const lastButtonStart = buttonChunk.lastIndexOf("<button")
    const buttonTag = html.slice(lastButtonStart, saveIndex)
    expect(buttonTag).toContain("disabled")
  })

  test("edit mode prefills title and selected chips", () => {
    const html = renderPanel({
      mode: "edit",
      initialTitle: "My Stack",
      initialProjectIds: ["p1"],
    })
    expect(html).toContain('value="My Stack"')
    const p1ChipIndex = html.indexOf("Project A")
    expect(p1ChipIndex).toBeGreaterThan(-1)
    const beforeChip = html.slice(0, p1ChipIndex)
    const lastButtonStart = beforeChip.lastIndexOf("<button")
    const chipTag = html.slice(lastButtonStart, p1ChipIndex)
    expect(chipTag).toContain("bg-primary")
  })

  test("single-project scenario shows the disabled banner", () => {
    const html = renderPanel({}, [{ id: "p1", title: "Project A" }])
    expect(html).toContain("Register a second project to create a stack")
  })

  test("submit button has type=submit and cancel has type=button", () => {
    const html = renderPanel({ initialTitle: "A Stack", initialProjectIds: ["p1", "p2"] })
    const saveIndex = html.indexOf("Save")
    const beforeSave = html.slice(0, saveIndex)
    const lastButtonStart = beforeSave.lastIndexOf("<button")
    const saveButtonTag = html.slice(lastButtonStart, saveIndex)
    expect(saveButtonTag).toContain('type="submit"')

    const cancelIndex = html.indexOf("Cancel")
    const beforeCancel = html.slice(0, cancelIndex)
    const lastCancelButtonStart = beforeCancel.lastIndexOf("<button")
    const cancelButtonTag = html.slice(lastCancelButtonStart, cancelIndex)
    expect(cancelButtonTag).toContain('type="button"')
  })

  test("title input has aria-label", () => {
    const html = renderPanel()
    expect(html).toContain('aria-label="Stack name"')
  })

  test("selected chips have aria-pressed=true, unselected have aria-pressed=false", () => {
    const html = renderPanel({
      initialProjectIds: ["p1"],
    })
    const p1Index = html.indexOf("Project A")
    expect(p1Index).toBeGreaterThan(-1)
    const beforeP1 = html.slice(0, p1Index)
    const p1ButtonStart = beforeP1.lastIndexOf("<button")
    const p1ChipTag = html.slice(p1ButtonStart, p1Index)
    expect(p1ChipTag).toContain('aria-pressed="true"')

    const p2Index = html.indexOf("Project B")
    expect(p2Index).toBeGreaterThan(-1)
    const beforeP2 = html.slice(0, p2Index)
    const p2ButtonStart = beforeP2.lastIndexOf("<button")
    const p2ChipTag = html.slice(p2ButtonStart, p2Index)
    expect(p2ChipTag).toContain('aria-pressed="false"')
  })
})

describe("StackCreatePanel — stack instructions", () => {
  test("renders the instructions field", () => {
    const html = renderPanel()
    expect(html).toContain('aria-label="Stack instructions"')
  })

  test("seeds the field from the stack being edited", () => {
    const html = renderPanel({ mode: "edit", initialInstructions: "api is upstream of web" })
    expect(html).toContain("api is upstream of web")
  })
})
