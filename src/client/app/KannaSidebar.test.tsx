import { afterEach, describe, expect, test } from "vite-plus/test"
import { type ComponentProps, act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import "../lib/testing/setupHappyDom"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "../components/ui/tooltip"
import { EMPTY_CHAT_ACTIVITY, type SidebarChatRow, type SidebarData, type SidebarProjectGroup } from "../../shared/types"
import { useKannaSidebarStore } from "../stores/kannaSidebarStore"
import { useSidebarSelectionStore } from "../stores/sidebarSelectionStore"
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

type SidebarProps = ComponentProps<typeof KannaSidebar>

function sidebarProps(data: SidebarData, overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
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
    currentProjectId: null,
    keybindings: null,
    actions: {
      onCreateChat: async () => undefined,
      onForkChat: async () => undefined,
      onRenameChat: async () => undefined,
      onArchiveChat: async () => undefined,
      onOpenArchivedChat: async () => undefined,
      onDeleteChat: async () => undefined,
      onArchiveBulkChats: async () => undefined,
      onDeleteBulkChats: async () => undefined,
      onOpenAddProjectModal: () => undefined,
      onCopyPath: async () => undefined,
      onOpenExternalPath: async () => undefined,
      onHideProject: async () => undefined,
      onDeleteProject: async () => undefined,
      onToggleStar: async () => undefined,
      onTogglePinChat: async () => undefined,
      onSetProjectInstructions: async () => undefined,
      onReorderProjectGroups: async () => undefined,
      onCreateStack: async () => undefined,
      onRenameStack: async () => undefined,
      onSetStackInstructions: async () => undefined,
      onRemoveStack: async () => undefined,
      onCreateStackChat: async () => undefined,
      onListStackWorktrees: async () => [],
    },
    editorLabel: "Cursor",
    updateSnapshot: null,
    ...overrides,
  }
}

function renderSidebar(data: SidebarData) {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(TooltipProvider, null, createElement(KannaSidebar, sidebarProps(data)))
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
  test("the brand header takes its height from the shared top-band token", () => {
    const html = renderSidebar({ starredProjectGroups: [], projectGroups: [], stacks: [] })

    expect(html).toContain(SHELL_TOP_BAND_CLASS)
  })
})

function chatRow(chatId: string): SidebarChatRow {
  return {
    _id: chatId,
    _creationTime: 1,
    chatId,
    title: `Chat ${chatId}`,
    status: "idle",
    unread: false,
    localPath: "/tmp/alpha",
    provider: "codex",
    activity: EMPTY_CHAT_ACTIVITY,
  }
}

function groupWithChats(chatIds: string[]): SidebarProjectGroup {
  const chats = chatIds.map(chatRow)
  return { ...createGroup("alpha"), chats, previewChats: chats }
}

function clickRow(container: HTMLElement, chatId: string, modifiers: MouseEventInit) {
  const button = container.querySelector(`[data-chat-id="${chatId}"] button`)
  if (!button) throw new Error(`no row button for ${chatId}`)
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers }))
  })
}

let unmountSidebar: (() => void) | null = null

afterEach(() => {
  unmountSidebar?.()
  unmountSidebar = null
  useSidebarSelectionStore.getState().stopSelecting()
})

describe("KannaSidebar modifier multi-select", () => {
  test("shift-click selects a range from the active chat, cmd-click adds one, and Archive receives the batch", async () => {
    const archived: string[][] = []
    const data: SidebarData = {
      starredProjectGroups: [],
      projectGroups: [groupWithChats(["A", "B", "C", "D"])],
      stacks: [],
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    unmountSidebar = () => {
      act(() => root.unmount())
      container.remove()
    }
    await act(async () => {
      root.render(createElement(
        MemoryRouter,
        null,
        createElement(TooltipProvider, null, createElement(KannaSidebar, sidebarProps(data, {
          activeChatId: "A",
          actions: {
            ...sidebarProps(data).actions,
            onArchiveBulkChats: async (chatIds) => {
              archived.push(chatIds)
            },
          },
        })))
      ))
    })

    clickRow(container, "C", { shiftKey: true })
    expect(container.textContent).toContain("3 selected")

    clickRow(container, "D", { metaKey: true })
    expect(container.textContent).toContain("4 selected")

    const archive = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("Archive") && !node.closest("[data-chat-id]"))
    if (!archive) throw new Error("no bulk Archive button")
    await act(async () => {
      archive.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(archived).toEqual([["A", "B", "C", "D"]])
  })
})

function mountSidebar(data: SidebarData) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  unmountSidebar = () => {
    act(() => {
      for (const node of container.querySelectorAll("*")) {
        for (const animation of node.getAnimations()) animation.finish()
      }
    })
    act(() => root.unmount())
    container.remove()
  }
  const show = (activeChatId: string | null) => act(() => {
    root.render(createElement(
      MemoryRouter,
      null,
      createElement(TooltipProvider, null, createElement(KannaSidebar, sidebarProps(data, { activeChatId }))),
    ))
  })
  return { container, show }
}

function projectGroup(groupKey: string, previewIds: string[], olderIds: string[], defaultCollapsed: boolean): SidebarProjectGroup {
  const previewChats = previewIds.map(chatRow)
  const olderChats = olderIds.map(chatRow)
  return { ...createGroup(groupKey), chats: [...previewChats, ...olderChats], previewChats, olderChats, defaultCollapsed }
}

const hasRow = (container: HTMLElement, chatId: string) => container.querySelector(`[data-chat-id="${chatId}"]`) !== null

describe("KannaSidebar reveals the active chat", () => {
  test("opening a chat whose project is collapsed expands that project", () => {
    const collapsed = projectGroup("collapsed-project", ["hidden-chat"], [], true)
    useKannaSidebarStore.getState().reconcileSidebarGroups([collapsed])
    const { container, show } = mountSidebar({ starredProjectGroups: [], projectGroups: [collapsed], stacks: [] })
    show(null)
    expect(hasRow(container, "hidden-chat")).toBe(false)

    show("hidden-chat")

    expect(hasRow(container, "hidden-chat")).toBe(true)
  })

  test("opening a chat listed under Show more expands the project's older chats", () => {
    const { container, show } = mountSidebar({
      starredProjectGroups: [],
      projectGroups: [projectGroup("long-project", ["recent-chat"], ["old-chat"], false)],
      stacks: [],
    })
    show(null)
    expect(hasRow(container, "old-chat")).toBe(false)

    show("old-chat")

    expect(hasRow(container, "old-chat")).toBe(true)
  })
})
