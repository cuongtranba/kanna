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
    // With no initialTitle, title state is "", Save must be disabled
    // Find Save button and check it has disabled attribute
    const saveIndex = html.indexOf("Save")
    // The disabled attribute appears in the button tag before "Save"
    const buttonChunk = html.slice(0, saveIndex)
    const lastButtonStart = buttonChunk.lastIndexOf("<button")
    const buttonTag = html.slice(lastButtonStart, saveIndex)
    expect(buttonTag).toContain("disabled")
  })

  test("Save button is disabled when fewer than 2 projects are selected", () => {
    // No initialProjectIds means 0 selected, even with a title
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
    // Input should have value="My Stack"
    expect(html).toContain('value="My Stack"')
    // The chip for p1 should have the active class (bg-primary)
    const p1ChipIndex = html.indexOf("Project A")
    expect(p1ChipIndex).toBeGreaterThan(-1)
    // Grab the chip button tag around Project A
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
    // Save button should have type="submit"
    const saveIndex = html.indexOf("Save")
    const beforeSave = html.slice(0, saveIndex)
    const lastButtonStart = beforeSave.lastIndexOf("<button")
    const saveButtonTag = html.slice(lastButtonStart, saveIndex)
    expect(saveButtonTag).toContain('type="submit"')

    // Cancel button should have type="button"
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
    // p1 chip (Project A) should have aria-pressed="true"
    const p1Index = html.indexOf("Project A")
    expect(p1Index).toBeGreaterThan(-1)
    const beforeP1 = html.slice(0, p1Index)
    const p1ButtonStart = beforeP1.lastIndexOf("<button")
    const p1ChipTag = html.slice(p1ButtonStart, p1Index)
    expect(p1ChipTag).toContain('aria-pressed="true"')

    // p2 chip (Project B) should have aria-pressed="false"
    const p2Index = html.indexOf("Project B")
    expect(p2Index).toBeGreaterThan(-1)
    const beforeP2 = html.slice(0, p2Index)
    const p2ButtonStart = beforeP2.lastIndexOf("<button")
    const p2ChipTag = html.slice(p2ButtonStart, p2Index)
    expect(p2ChipTag).toContain('aria-pressed="false"')
  })
})
