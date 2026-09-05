import { beforeEach, describe, expect, test } from "bun:test"
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_CONTENT_MIN_WIDTH,
  SIDEBAR_CONTENT_MIN_WIDTH_SETTINGS,
  resolveSidebarWidth,
  useKannaSidebarStore,
} from "./kannaSidebarStore"

function reset() {
  useKannaSidebarStore.setState({
    collapsedSections: new Set<string>(),
    expandedGroups: new Set<string>(),
    expandedGroupsSnapshot: new Set<string>(),
    initializedCollapsedGroupKeys: new Set<string>(),
    expandedStackIds: new Set<string>(),
    stackCreatePanelOpen: false,
    stackEditId: null,
    stackDeleteConfirmId: null,
    stackChatCreateId: null,
    stackChatLoading: false,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  })
}

const s = () => useKannaSidebarStore.getState()

describe("kannaSidebarStore — stacks", () => {
  beforeEach(reset)

  test("toggleStackExpanded adds then removes, without the caller rebuilding the Set", () => {
    s().toggleStackExpanded("stack-1")
    expect(s().expandedStackIds.has("stack-1")).toBe(true)

    s().toggleStackExpanded("stack-1")
    expect(s().expandedStackIds.has("stack-1")).toBe(false)
  })

  test("toggleStackExpanded leaves other stacks alone and returns a new Set", () => {
    s().toggleStackExpanded("stack-1")
    const before = s().expandedStackIds
    s().toggleStackExpanded("stack-2")

    expect(s().expandedStackIds).not.toBe(before)
    expect(s().expandedStackIds.has("stack-1")).toBe(true)
    expect(s().expandedStackIds.has("stack-2")).toBe(true)
  })

  test("openStackEditPanel opens the panel in edit mode in one transition", () => {
    s().openStackEditPanel("stack-7")

    expect(s().stackCreatePanelOpen).toBe(true)
    expect(s().stackEditId).toBe("stack-7")
  })

  test("openStackCreatePanel opens in create mode, clearing a stale edit target", () => {
    s().openStackEditPanel("stack-7")
    s().closeStackPanel()
    s().openStackCreatePanel()

    expect(s().stackCreatePanelOpen).toBe(true)
    expect(s().stackEditId).toBeNull()
  })

  test("closeStackPanel closes and clears the edit target together", () => {
    s().openStackEditPanel("stack-7")

    s().closeStackPanel()

    expect(s().stackCreatePanelOpen).toBe(false)
    expect(s().stackEditId).toBeNull()
  })

  test("closeStackPanel is a no-op when already closed", () => {
    const before = s()
    before.closeStackPanel()
    expect(useKannaSidebarStore.getState()).toBe(before)
  })
})

describe("kannaSidebarStore — stack chat creation", () => {
  beforeEach(reset)

  test("beginStackChatCreate opens the row in a loading state", () => {
    s().beginStackChatCreate("stack-1")

    expect(s().stackChatCreateId).toBe("stack-1")
    expect(s().stackChatLoading).toBe(true)
  })

  test("finishStackChatCreate stores the worktrees and clears loading", () => {
    s().beginStackChatCreate("stack-1")
    const worktrees = new Map([["p1", []]])

    s().finishStackChatCreate(worktrees)

    expect(s().stackChatWorktrees).toBe(worktrees)
    expect(s().stackChatLoading).toBe(false)
  })

  test("closeStackChatCreate clears the row and its worktrees", () => {
    s().beginStackChatCreate("stack-1")
    s().finishStackChatCreate(new Map([["p1", []]]))

    s().closeStackChatCreate()

    expect(s().stackChatCreateId).toBeNull()
    expect(s().stackChatWorktrees.size).toBe(0)
  })
})

describe("kannaSidebarStore — sections and groups", () => {
  beforeEach(reset)

  test("toggleSectionCollapsed flips one key", () => {
    s().toggleSectionCollapsed("g1")
    expect(s().collapsedSections.has("g1")).toBe(true)
    s().toggleSectionCollapsed("g1")
    expect(s().collapsedSections.has("g1")).toBe(false)
  })

  test("toggleGroupExpanded flips one key", () => {
    s().toggleGroupExpanded("g1")
    expect(s().expandedGroups.has("g1")).toBe(true)
    s().toggleGroupExpanded("g1")
    expect(s().expandedGroups.has("g1")).toBe(false)
  })

  test("toggleAllSectionsCollapsed collapses everything, then restores the previous expansion", () => {
    s().toggleGroupExpanded("g1")

    s().toggleAllSectionsCollapsed(["g1", "g2"])
    expect(s().collapsedSections).toEqual(new Set(["g1", "g2"]))
    expect(s().expandedGroups.size).toBe(0)

    s().toggleAllSectionsCollapsed(["g1", "g2"])
    expect(s().collapsedSections.size).toBe(0)
    expect(s().expandedGroups).toEqual(new Set(["g1"]))
  })

  test("toggleAllSectionsCollapsed with no groups is a no-op", () => {
    const before = s()
    before.toggleAllSectionsCollapsed([])
    expect(useKannaSidebarStore.getState()).toBe(before)
  })

  describe("reconcileSidebarGroups", () => {
    test("applies defaultCollapsed the first time a group is seen", () => {
      s().reconcileSidebarGroups([
        { groupKey: "g1", defaultCollapsed: true },
        { groupKey: "g2", defaultCollapsed: false },
      ])

      expect(s().collapsedSections).toEqual(new Set(["g1"]))
    })

    test("does not re-apply defaultCollapsed after the user expands the group", () => {
      s().reconcileSidebarGroups([{ groupKey: "g1", defaultCollapsed: true }])
      s().toggleSectionCollapsed("g1")
      expect(s().collapsedSections.has("g1")).toBe(false)

      s().reconcileSidebarGroups([{ groupKey: "g1", defaultCollapsed: true }])

      expect(s().collapsedSections.has("g1")).toBe(false)
    })

    test("drops collapsed keys for groups that no longer exist", () => {
      s().reconcileSidebarGroups([
        { groupKey: "g1", defaultCollapsed: true },
        { groupKey: "g2", defaultCollapsed: true },
      ])
      expect(s().collapsedSections).toEqual(new Set(["g1", "g2"]))

      s().reconcileSidebarGroups([{ groupKey: "g1", defaultCollapsed: true }])

      expect(s().collapsedSections).toEqual(new Set(["g1"]))
    })

    test("re-applies defaultCollapsed once a removed group comes back", () => {
      s().reconcileSidebarGroups([{ groupKey: "g1", defaultCollapsed: true }])
      s().toggleSectionCollapsed("g1")
      s().reconcileSidebarGroups([])

      s().reconcileSidebarGroups([{ groupKey: "g1", defaultCollapsed: true }])

      expect(s().collapsedSections.has("g1")).toBe(true)
    })

    test("keeps the same collapsedSections reference when nothing changed", () => {
      s().reconcileSidebarGroups([{ groupKey: "g1", defaultCollapsed: true }])
      const before = s().collapsedSections

      s().reconcileSidebarGroups([{ groupKey: "g1", defaultCollapsed: true }])

      expect(s().collapsedSections).toBe(before)
    })
  })
})

describe("kannaSidebarStore — width", () => {
  beforeEach(reset)

  test("nudgeSidebarWidth steps and clamps inside the store", () => {
    s().nudgeSidebarWidth(16)
    expect(s().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH + 16)

    for (let i = 0; i < 100; i++) s().nudgeSidebarWidth(-16)
    expect(s().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH)

    for (let i = 0; i < 100; i++) s().nudgeSidebarWidth(16)
    expect(s().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH)
  })

  test("setSidebarWidth clamps out-of-range values", () => {
    s().setSidebarWidth(10_000)
    expect(s().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH)

    s().setSidebarWidth(0)
    expect(s().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH)
  })
})

describe("resolveSidebarWidth", () => {
  test("honours the requested width when the viewport can afford it", () => {
    expect(resolveSidebarWidth({ requestedWidth: MAX_SIDEBAR_WIDTH, viewportWidth: 1440 })).toBe(
      MAX_SIDEBAR_WIDTH,
    )
  })

  test("gives the content column its minimum before the sidebar gets its wish", () => {
    expect(resolveSidebarWidth({ requestedWidth: MAX_SIDEBAR_WIDTH, viewportWidth: 900 })).toBe(
      900 - SIDEBAR_CONTENT_MIN_WIDTH,
    )
  })

  test("never yields less than the sidebar floor, even on a tiny viewport", () => {
    expect(resolveSidebarWidth({ requestedWidth: MAX_SIDEBAR_WIDTH, viewportWidth: 560 })).toBe(
      MIN_SIDEBAR_WIDTH,
    )
    expect(resolveSidebarWidth({ requestedWidth: MAX_SIDEBAR_WIDTH, viewportWidth: 100 })).toBe(
      MIN_SIDEBAR_WIDTH,
    )
  })

  test("passes the stored width through when the viewport is unmeasured", () => {
    expect(resolveSidebarWidth({ requestedWidth: MAX_SIDEBAR_WIDTH, viewportWidth: 0 })).toBe(
      MAX_SIDEBAR_WIDTH,
    )
  })

  test("still clamps the request to the sidebar's own bounds", () => {
    expect(resolveSidebarWidth({ requestedWidth: 10_000, viewportWidth: 4000 })).toBe(
      MAX_SIDEBAR_WIDTH,
    )
    expect(resolveSidebarWidth({ requestedWidth: 10, viewportWidth: 1440 })).toBe(
      MIN_SIDEBAR_WIDTH,
    )
    expect(resolveSidebarWidth({ requestedWidth: Number.NaN, viewportWidth: 1440 })).toBe(
      DEFAULT_SIDEBAR_WIDTH,
    )
  })

  test("reserves more room for the settings split layout", () => {
    const args = { requestedWidth: MAX_SIDEBAR_WIDTH, viewportWidth: 1000 }
    expect(resolveSidebarWidth(args)).toBe(MAX_SIDEBAR_WIDTH)
    expect(
      resolveSidebarWidth({ ...args, contentMinWidth: SIDEBAR_CONTENT_MIN_WIDTH_SETTINGS }),
    ).toBe(1000 - SIDEBAR_CONTENT_MIN_WIDTH_SETTINGS)
  })

  test("is monotonic in viewport width", () => {
    let previous = 0
    for (let viewportWidth = 300; viewportWidth <= 2000; viewportWidth += 10) {
      const width = resolveSidebarWidth({ requestedWidth: MAX_SIDEBAR_WIDTH, viewportWidth })
      expect(width).toBeGreaterThanOrEqual(previous)
      previous = width
    }
  })
})
