import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "../components/ui/tooltip"
import type { SidebarData, SidebarProjectGroup } from "../../shared/types"
import { KannaSidebar } from "./KannaSidebar"
import { SHELL_TOP_BAND_CLASS } from "../lib/shellChrome"

const STACKS_EMPTY_COPY = "Add your first stack"
const HEADING_TESTID = 'data-testid="sidebar-section-heading"'

function createGroup(groupKey: string, starredAt?: number): SidebarProjectGroup {
  return {
    groupKey,
    localPath: `/tmp/${groupKey}`,
    chats: [],
    previewChats: [],
    olderChats: [],
    defaultCollapsed: false,
    ...(starredAt === undefined ? {} : { starredAt }),
  }
}

function renderSidebar(data: SidebarData) {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(
      TooltipProvider,
      null,
      createElement(KannaSidebar, {
        data,
        activeChatId: null,
        connectionStatus: "connected",
        open: true,
        collapsed: false,
        showMobileOpenButton: false,
        onOpen: () => undefined,
        onClose: () => undefined,
        onCollapse: () => undefined,
        onExpand: () => undefined,
        onCreateChat: () => undefined,
        onForkChat: () => undefined,
        currentProjectId: null,
        keybindings: null,
        onRenameChat: () => undefined,
        onArchiveChat: () => undefined,
        onOpenArchivedChat: () => undefined,
        onDeleteChat: () => undefined,
        onDeleteBulkChats: () => undefined,
        onOpenAddProjectModal: () => undefined,
        onCopyPath: () => undefined,
        onOpenExternalPath: () => undefined,
        onHideProject: () => undefined,
        onToggleStar: () => undefined,
        onReorderProjectGroups: () => undefined,
        onCreateStack: () => undefined,
        onRenameStack: () => undefined,
        onRemoveStack: () => undefined,
        onCreateStackChat: () => undefined,
        onListStackWorktrees: async () => [],
        editorLabel: "Cursor",
        updateSnapshot: null,
      })
    )
  ))
}

describe("KannaSidebar section headings", () => {
  test("a starred project is labelled Starred instead of trailing the Stacks section", () => {
    const html = renderSidebar({
      starredProjectGroups: [createGroup("alpha", 42)],
      projectGroups: [createGroup("beta")],
      stacks: [],
    })

    const stacksCopyIndex = html.indexOf(STACKS_EMPTY_COPY)
    const starredHeadingIndex = html.indexOf("Starred", html.indexOf(HEADING_TESTID))
    const alphaIndex = html.indexOf("alpha")

    expect(stacksCopyIndex).toBeGreaterThan(-1)
    expect(starredHeadingIndex).toBeGreaterThan(-1)
    // The starred project must sit under its own heading, which comes after the
    // Stacks copy — otherwise it reads as a member of the Stacks section.
    expect(stacksCopyIndex).toBeLessThan(starredHeadingIndex)
    expect(starredHeadingIndex).toBeLessThan(alphaIndex)
  })

  test("unstarred projects are labelled Projects", () => {
    const html = renderSidebar({
      starredProjectGroups: [createGroup("alpha", 42)],
      projectGroups: [createGroup("beta")],
      stacks: [],
    })

    const projectsHeadingIndex = html.indexOf("Projects")
    const betaIndex = html.indexOf("beta")

    expect(projectsHeadingIndex).toBeGreaterThan(-1)
    expect(projectsHeadingIndex).toBeLessThan(betaIndex)
    // "alpha" is starred, so it belongs above the Projects heading.
    expect(html.indexOf("alpha")).toBeLessThan(projectsHeadingIndex)
  })

  test("the Projects heading still labels the list when nothing is starred", () => {
    const html = renderSidebar({
      starredProjectGroups: [],
      projectGroups: [createGroup("beta")],
      stacks: [],
    })

    expect(html).toContain(HEADING_TESTID)
    expect(html.indexOf(HEADING_TESTID)).toBeLessThan(html.indexOf("beta"))
  })
})

describe("KannaSidebar Stacks Boards affordance", () => {
  // KannaSidebar owns navigation (handleOpenStackBoards → `/boards/stack/:id`)
  // and hands it to StacksSection as a plain prop; this pins that wiring the
  // whole way down without throwing, mirroring the project row's own Boards
  // item which is exercised the same way (structural render, not a click sim).
  test("renders a Stack row's actions menu without throwing", () => {
    expect(() =>
      renderSidebar({
        starredProjectGroups: [],
        projectGroups: [],
        stacks: [
          {
            id: "stack-1",
            title: "Kanna + ccom",
            projectIds: [],
            memberCount: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      })
    ).not.toThrow()
  })
})

describe("KannaSidebar top chrome band", () => {
  // The other half of the shell's top-band contract (the pane tab strip side is
  // asserted in PaneTabStrip.test.tsx). Both bands must read their height from
  // the shared token; a literal height on either one is what put the brand
  // header and the tab strip on different lines.
  test("the brand header takes its height from the shared top-band token", () => {
    const html = renderSidebar({ starredProjectGroups: [], projectGroups: [], stacks: [] })

    expect(html).toContain(SHELL_TOP_BAND_CLASS)
  })
})
