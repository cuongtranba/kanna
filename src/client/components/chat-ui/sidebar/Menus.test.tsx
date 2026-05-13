import { describe, expect, test, mock } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectSectionMenu } from "./Menus"

type MenuProps = Omit<Parameters<typeof ProjectSectionMenu>[0], "children">

function defaultProps(overrides: Partial<MenuProps> = {}): MenuProps {
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
    expect(() =>
      renderToStaticMarkup(
        <ProjectSectionMenu {...defaultProps({ starred: false })}>
          <button>trigger</button>
        </ProjectSectionMenu>
      )
    ).not.toThrow()
  })

  test("shows 'Unstar project' when starred", () => {
    expect(() =>
      renderToStaticMarkup(
        <ProjectSectionMenu {...defaultProps({ starred: true })}>
          <button>trigger</button>
        </ProjectSectionMenu>
      )
    ).not.toThrow()
  })

  test("accepts onToggleStar callback without throwing", () => {
    const onToggleStar = mock(() => undefined)
    expect(() =>
      renderToStaticMarkup(
        <ProjectSectionMenu {...defaultProps({ starred: false, onToggleStar })}>
          <button>trigger</button>
        </ProjectSectionMenu>
      )
    ).not.toThrow()
  })

  test("renders children inside trigger", () => {
    const html = renderToStaticMarkup(
      <ProjectSectionMenu {...defaultProps()}>
        <button>project trigger</button>
      </ProjectSectionMenu>
    )
    expect(html).toContain("project trigger")
  })
})
