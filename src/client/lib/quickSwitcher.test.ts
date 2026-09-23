import { describe, expect, test } from "bun:test"
import { DEFAULT_KEYBINDINGS, type KeybindingsSnapshot, type SidebarChatRow, type SidebarData } from "../../shared/types"
import {
  clampHighlight,
  filterProjects,
  filterSessions,
  isMacUserAgent,
  scoreMatch,
  shortenHomePath,
  shouldToggleQuickSwitcher,
  toQuickSwitcherProjects,
  toQuickSwitcherSessions,
} from "./quickSwitcher"

const keybindings: KeybindingsSnapshot = {
  bindings: { ...DEFAULT_KEYBINDINGS },
  warning: null,
  filePathDisplay: "",
}

function chat(overrides: Partial<SidebarChatRow> & { chatId: string }): SidebarChatRow {
  return {
    _id: overrides.chatId,
    _creationTime: 0,
    title: "Session",
    status: "idle",
    unread: false,
    localPath: "/home/dev/alpha",
    provider: null,
    activity: {
      agents: 0,
      workflow: null,
      loop: null,
      backgroundTasks: 0,
      cron: null,
      awaitingAnswer: false,
      lastRunFailure: null,
    },
    ...overrides,
  }
}

function sidebarData(): SidebarData {
  return {
    starredProjectGroups: [{
      groupKey: "p-starred",
      localPath: "/home/dev/kanna",
      starredAt: 10,
      defaultCollapsed: false,
      chats: [chat({ chatId: "c1", title: "Fix the parser", lastMessageAt: 500 })],
      previewChats: [],
      olderChats: [],
    }],
    projectGroups: [{
      groupKey: "p-alpha",
      localPath: "/home/dev/alpha",
      defaultCollapsed: false,
      chats: [
        chat({ chatId: "c2", title: "Older work", lastMessageAt: 100 }),
        chat({ chatId: "c3", title: "Newest work", lastMessageAt: 900 }),
        chat({ chatId: "c4", title: "Stack worker", lastMessageAt: 950, stackId: "s1" }),
      ],
      previewChats: [],
      olderChats: [],
    }],
    stacks: [],
  }
}

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init)
}

function keyEventOn(target: Element, init: KeyboardEventInit): KeyboardEvent {
  let captured: KeyboardEvent | null = null
  const listen = (event: Event) => {
    if (event instanceof KeyboardEvent) captured = event
  }
  target.addEventListener("keydown", listen)
  target.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true }))
  target.removeEventListener("keydown", listen)
  if (captured === null) throw new Error("keydown was not dispatched")
  return captured
}

describe("scoreMatch", () => {
  test("ranks a prefix match above a word-start match", () => {
    const prefix = scoreMatch("kanna", "kan")
    const wordStart = scoreMatch("my-kanna", "kan")
    expect(prefix).not.toBeNull()
    expect(wordStart).not.toBeNull()
    expect(prefix as number).toBeGreaterThan(wordStart as number)
  })

  test("ranks a substring match above a subsequence match", () => {
    const substring = scoreMatch("workspace", "rks")
    const subsequence = scoreMatch("wreckless", "rks")
    expect(substring).not.toBeNull()
    expect(subsequence).not.toBeNull()
    expect(substring as number).toBeGreaterThan(subsequence as number)
  })

  test("returns null when the characters are absent or out of order", () => {
    expect(scoreMatch("kanna", "zx")).toBeNull()
    expect(scoreMatch("kanna", "ak")).toBeNull()
  })

  test("an empty query matches everything", () => {
    expect(scoreMatch("kanna", "")).toBe(0)
  })
})

describe("toQuickSwitcherProjects", () => {
  test("excludes chats that belong to a stack from the session count", () => {
    const projects = toQuickSwitcherProjects(sidebarData())
    const alpha = projects.find((project) => project.projectId === "p-alpha")
    expect(alpha?.sessionCount).toBe(2)
  })

  test("marks a starred group and names a project by its path basename", () => {
    const projects = toQuickSwitcherProjects(sidebarData())
    const starred = projects.find((project) => project.projectId === "p-starred")
    expect(starred?.starred).toBe(true)
    expect(starred?.name).toBe("kanna")
  })

  test("includes an indexed project that has no sessions yet, with no project id", () => {
    const projects = toQuickSwitcherProjects(sidebarData(), [
      { localPath: "/home/dev/fresh", title: "fresh", source: "discovered", chatCount: 0 },
    ])
    const fresh = projects.find((project) => project.localPath === "/home/dev/fresh")
    expect(fresh?.projectId).toBeNull()
    expect(fresh?.sessionCount).toBe(0)
  })

  test("does not list a project twice when both sources know its path", () => {
    const projects = toQuickSwitcherProjects(sidebarData(), [
      { localPath: "/home/dev/kanna", title: "kanna", source: "saved", chatCount: 1 },
    ])
    expect(projects.filter((project) => project.localPath === "/home/dev/kanna")).toHaveLength(1)
    expect(projects.find((project) => project.localPath === "/home/dev/kanna")?.projectId).toBe("p-starred")
  })

  test("a project with sessions outranks a never-opened one at the same match quality", () => {
    const projects = toQuickSwitcherProjects(sidebarData(), [
      { localPath: "/elsewhere/alpha", title: "alpha", source: "discovered", chatCount: 0 },
    ])
    expect(filterProjects(projects, "alpha")[0]?.projectId).toBe("p-alpha")
  })
})

describe("toQuickSwitcherSessions", () => {
  test("omits stack sessions and returns the newest first", () => {
    const sessions = toQuickSwitcherSessions(sidebarData(), "p-alpha")
    expect(sessions.map((session) => session.chatId)).toEqual(["c3", "c2"])
  })

  test("returns nothing for an unknown project", () => {
    expect(toQuickSwitcherSessions(sidebarData(), "missing")).toEqual([])
  })
})

describe("filterProjects", () => {
  test("a starred project wins a tie against an equally scored one", () => {
    const projects = toQuickSwitcherProjects({
      starredProjectGroups: [{
        groupKey: "p-b",
        localPath: "/home/dev/app",
        starredAt: 1,
        defaultCollapsed: false,
        chats: [],
        previewChats: [],
        olderChats: [],
      }],
      projectGroups: [{
        groupKey: "p-a",
        localPath: "/work/app",
        defaultCollapsed: false,
        chats: [],
        previewChats: [],
        olderChats: [],
      }],
      stacks: [],
    })
    expect(filterProjects(projects, "app")[0]?.projectId).toBe("p-b")
  })

  test("drops projects that do not match", () => {
    const projects = toQuickSwitcherProjects(sidebarData())
    expect(filterProjects(projects, "kanna").map((p) => p.projectId)).toEqual(["p-starred"])
  })
})

describe("filterSessions", () => {
  test("ranks a title prefix above a mid-word match", () => {
    const sessions = toQuickSwitcherSessions(sidebarData(), "p-alpha")
    expect(filterSessions(sessions, "newest")[0]?.chatId).toBe("c3")
  })

  test("an empty query keeps every session in recency order", () => {
    const sessions = toQuickSwitcherSessions(sidebarData(), "p-alpha")
    expect(filterSessions(sessions, "").map((s) => s.chatId)).toEqual(["c3", "c2"])
  })
})

describe("shouldToggleQuickSwitcher", () => {
  test("matches the bound shortcut on both platforms", () => {
    expect(shouldToggleQuickSwitcher(keybindings, keyEvent({ key: "k", metaKey: true }))).toBe(true)
    expect(shouldToggleQuickSwitcher(keybindings, keyEvent({ key: "k", ctrlKey: true }))).toBe(true)
  })

  test("ignores the key without its modifier", () => {
    expect(shouldToggleQuickSwitcher(keybindings, keyEvent({ key: "k" }))).toBe(false)
  })

  test("stands down inside the embedded terminal so ctrl+k still kills the shell line", () => {
    const container = document.createElement("div")
    container.className = "kanna-terminal"
    const textarea = document.createElement("textarea")
    container.appendChild(textarea)
    document.body.appendChild(container)

    try {
      const event = keyEventOn(textarea, { key: "k", ctrlKey: true })
      expect(shouldToggleQuickSwitcher(keybindings, event)).toBe(false)
    } finally {
      container.remove()
    }
  })

  test("still fires for a plain textarea outside the terminal", () => {
    const textarea = document.createElement("textarea")
    document.body.appendChild(textarea)

    try {
      const event = keyEventOn(textarea, { key: "k", metaKey: true })
      expect(shouldToggleQuickSwitcher(keybindings, event)).toBe(true)
    } finally {
      textarea.remove()
    }
  })
})

describe("shortenHomePath", () => {
  test("replaces the home directory with a tilde", () => {
    expect(shortenHomePath("/home/dev/kanna", "/home/dev")).toBe("~/kanna")
  })

  test("leaves a path outside the home directory alone", () => {
    expect(shortenHomePath("/srv/app", "/home/dev")).toBe("/srv/app")
  })

  test("does not shorten a sibling directory that merely shares a prefix", () => {
    expect(shortenHomePath("/home/developer/app", "/home/dev")).toBe("/home/developer/app")
  })
})

describe("isMacUserAgent", () => {
  test("detects mac and leaves other platforms on the control label", () => {
    expect(isMacUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true)
    expect(isMacUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false)
  })
})

describe("clampHighlight", () => {
  test("wraps around both ends of the list", () => {
    expect(clampHighlight(-1, 3)).toBe(2)
    expect(clampHighlight(3, 3)).toBe(0)
    expect(clampHighlight(1, 3)).toBe(1)
  })

  test("stays at zero for an empty list", () => {
    expect(clampHighlight(2, 0)).toBe(0)
  })
})
