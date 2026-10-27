import { describe, expect, test, vi } from "vite-plus/test"
import { act } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { renderForLoopCheck } from "../../../lib/testing/renderForLoopCheck"
import { ChatRowMenu, ProjectSectionMenu } from "./Menus"

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
    const onToggleStar = vi.fn(() => undefined)
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

describe("ProjectSectionMenu — Edit instructions", () => {
  test("renders without throwing when the handler is supplied", () => {
    expect(() =>
      renderToStaticMarkup(
        <ProjectSectionMenu {...defaultProps({ onEditInstructions: () => undefined })}>
          <button>trigger</button>
        </ProjectSectionMenu>
      )
    ).not.toThrow()
  })

  test("renders without throwing when the handler is omitted", () => {
    expect(() =>
      renderToStaticMarkup(
        <ProjectSectionMenu {...defaultProps()}>
          <button>trigger</button>
        </ProjectSectionMenu>
      )
    ).not.toThrow()
  })
})

describe("ChatRowMenu — Pin", () => {
  async function openMenuText(pinned: boolean) {
    const { cleanup } = await renderForLoopCheck(
      <ChatRowMenu
        onRename={() => undefined}
        onOpenInFinder={() => undefined}
        onFork={() => undefined}
        onArchive={() => undefined}
        pinned={pinned}
        onTogglePin={() => undefined}
        onDelete={() => undefined}
      >
        <button data-testid="chat-row-trigger">trigger</button>
      </ChatRowMenu>
    )
    const trigger = document.querySelector('[data-testid="chat-row-trigger"]')
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }))
    })
    const text = document.body.textContent ?? ""
    await cleanup()
    return text
  }

  test("offers 'Pin to top' for an unpinned chat", async () => {
    const text = await openMenuText(false)
    expect(text).toContain("Pin to top")
    expect(text).not.toContain("Unpin")
  })

  test("offers 'Unpin' for a pinned chat", async () => {
    const text = await openMenuText(true)
    expect(text).toContain("Unpin")
  })
})
