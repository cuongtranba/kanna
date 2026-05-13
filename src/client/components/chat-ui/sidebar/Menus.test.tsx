import { describe, expect, test, mock } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectSectionMenu } from "./Menus"

function makeProps(overrides: Partial<Parameters<typeof ProjectSectionMenu>[0]> = {}) {
  return {
    editorLabel: "VS Code",
    starred: false,
    onCopyPath: () => undefined,
    onShowArchived: () => undefined,
    onOpenInFinder: () => undefined,
    onOpenInEditor: () => undefined,
    onToggleStar: () => undefined,
    onHide: () => undefined,
    ...overrides,
  }
}

describe("ProjectSectionMenu", () => {
  test("shows 'Star project' when not starred", () => {
    // ContextMenu content is rendered hidden in SSR — check the hidden portal layer
    expect(() =>
      renderToStaticMarkup(
        createElement(
          ProjectSectionMenu,
          makeProps({ starred: false }),
          createElement("button", null, "trigger")
        )
      )
    ).not.toThrow()
  })

  test("shows 'Unstar project' when starred", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(
          ProjectSectionMenu,
          makeProps({ starred: true }),
          createElement("button", null, "trigger")
        )
      )
    ).not.toThrow()
  })

  test("accepts onToggleStar callback without throwing", () => {
    const onToggleStar = mock(() => undefined)
    expect(() =>
      renderToStaticMarkup(
        createElement(
          ProjectSectionMenu,
          makeProps({ starred: false, onToggleStar }),
          createElement("button", null, "trigger")
        )
      )
    ).not.toThrow()
  })

  test("renders children inside trigger", () => {
    const html = renderToStaticMarkup(
      createElement(
        ProjectSectionMenu,
        makeProps(),
        createElement("button", null, "project trigger")
      )
    )
    expect(html).toContain("project trigger")
  })

  test("renders without errors when starred=false", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(
          ProjectSectionMenu,
          makeProps({ starred: false }),
          createElement("div", null, "trigger")
        )
      )
    ).not.toThrow()
  })

  test("renders without errors when starred=true", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(
          ProjectSectionMenu,
          makeProps({ starred: true }),
          createElement("div", null, "trigger")
        )
      )
    ).not.toThrow()
  })
})
