import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { LocalProjectSummary, SidebarChatRow, SidebarData } from "../../../shared/types"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { useKannaStateStore } from "../../stores/kannaStateStore"
import { useQuickSwitcherStore } from "../../stores/quickSwitcherStore"
import { QuickSwitcher } from "./QuickSwitcher"

function chat(chatId: string, title: string, lastMessageAt: number, stackId?: string): SidebarChatRow {
  return {
    _id: chatId,
    _creationTime: 0,
    chatId,
    title,
    status: "idle",
    unread: false,
    localPath: "/home/dev/kanna",
    provider: null,
    lastMessageAt,
    stackId,
    activity: {
      agents: 0,
      workflow: null,
      loop: null,
      backgroundTasks: 0,
      cron: null,
      awaitingAnswer: false,
      lastRunFailure: null,
    },
  }
}

const SIDEBAR: SidebarData = {
  starredProjectGroups: [],
  projectGroups: [
    {
      groupKey: "p-kanna",
      localPath: "/home/dev/kanna",
      defaultCollapsed: false,
      chats: [
        chat("c-new", "Newest session", 900),
        chat("c-old", "Older session", 100),
        chat("c-stack", "Stack worker", 950, "s1"),
      ],
      previewChats: [],
      olderChats: [],
    },
    {
      groupKey: "p-website",
      localPath: "/home/dev/website",
      defaultCollapsed: false,
      chats: [],
      previewChats: [],
      olderChats: [],
    },
  ],
  stacks: [],
}

const LOCAL_PROJECTS: LocalProjectSummary[] = [
  { localPath: "/home/dev/kanna", title: "kanna", source: "saved", chatCount: 2 },
  { localPath: "/home/dev/never-opened", title: "never-opened", source: "discovered", chatCount: 0 },
]

interface Harness {
  opened: string[]
  created: string[]
  openedPaths: string[]
  cleanup: () => Promise<void>
  errors: string[]
  loopWarnings: string[]
}

async function mount(): Promise<Harness> {
  const opened: string[] = []
  const created: string[] = []
  const openedPaths: string[] = []

  act(() => {
    useKannaStateStore.getState().setSidebarData(SIDEBAR)
    useQuickSwitcherStore.getState().openSwitcher()
  })

  const rendered = await renderForLoopCheck(
    <QuickSwitcher
      homeDir="/home/dev"
      localProjects={LOCAL_PROJECTS}
      onOpenChat={(chatId) => opened.push(chatId)}
      onCreateChat={(projectId) => created.push(projectId)}
      onOpenProjectPath={(localPath) => openedPaths.push(localPath)}
    />,
  )

  return {
    opened,
    created,
    openedPaths,
    errors: rendered.errors,
    loopWarnings: rendered.loopWarnings,
    cleanup: rendered.cleanup,
  }
}

function input(): HTMLInputElement {
  const element = document.querySelector('[role="combobox"]')
  if (!(element instanceof HTMLInputElement)) throw new Error("combobox input not found")
  return element
}

function optionLabels(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent ?? "")
}

function type(value: string) {
  const field = input()
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
  })
}

afterEach(() => {
  act(() => {
    useQuickSwitcherStore.getState().closeSwitcher()
  })
})

describe("QuickSwitcher", () => {
  test("filtering to a project and pressing Enter lists that project's sessions", async () => {
    const harness = await mount()
    try {
      type("website")
      expect(optionLabels().some((label) => label.includes("website"))).toBe(true)

      type("kanna")
      press("Enter")

      const labels = optionLabels()
      expect(labels.some((label) => label.includes("Newest session"))).toBe(true)
      expect(labels.some((label) => label.includes("New chat in kanna"))).toBe(true)
    } finally {
      await harness.cleanup()
    }
  })

  test("a session belonging to a stack is never offered", async () => {
    const harness = await mount()
    try {
      type("kanna")
      press("Enter")
      expect(optionLabels().some((label) => label.includes("Stack worker"))).toBe(false)
    } finally {
      await harness.cleanup()
    }
  })

  test("Enter on the default highlight opens the most recent session", async () => {
    const harness = await mount()
    try {
      type("kanna")
      press("Enter")
      press("Enter")
      expect(harness.opened).toEqual(["c-new"])
      expect(harness.created).toEqual([])
    } finally {
      await harness.cleanup()
    }
  })

  test("arrowing down and pressing Enter opens the second session", async () => {
    const harness = await mount()
    try {
      type("kanna")
      press("Enter")
      press("ArrowDown")
      press("Enter")
      expect(harness.opened).toEqual(["c-old"])
    } finally {
      await harness.cleanup()
    }
  })

  test("Cmd+Enter on a project starts a new chat without opening a session", async () => {
    const harness = await mount()
    try {
      type("kanna")
      press("Enter", { metaKey: true })
      expect(harness.created).toEqual(["p-kanna"])
      expect(harness.opened).toEqual([])
    } finally {
      await harness.cleanup()
    }
  })

  test("a project with no sessions starts a new chat directly", async () => {
    const harness = await mount()
    try {
      type("website")
      press("Enter")
      expect(harness.created).toEqual(["p-website"])
    } finally {
      await harness.cleanup()
    }
  })

  test("finds an indexed project that has never been opened", async () => {
    const harness = await mount()
    try {
      type("never")
      expect(optionLabels().some((label) => label.includes("never-opened"))).toBe(true)
    } finally {
      await harness.cleanup()
    }
  })

  test("Enter on a never-opened project opens it by path rather than by project id", async () => {
    const harness = await mount()
    try {
      type("never")
      press("Enter")
      expect(harness.openedPaths).toEqual(["/home/dev/never-opened"])
      expect(harness.created).toEqual([])
    } finally {
      await harness.cleanup()
    }
  })

  test("a project present in both sources is listed once", async () => {
    const harness = await mount()
    try {
      type("kanna")
      expect(optionLabels().filter((label) => label.includes("kanna")).length).toBe(1)
    } finally {
      await harness.cleanup()
    }
  })

  test("Backspace on an empty session query returns to the project list", async () => {
    const harness = await mount()
    try {
      type("kanna")
      press("Enter")
      expect(optionLabels().some((label) => label.includes("Newest session"))).toBe(true)

      press("Backspace")
      expect(optionLabels().some((label) => label.includes("website"))).toBe(true)
    } finally {
      await harness.cleanup()
    }
  })

  test("choosing a session closes the switcher so it cannot fire twice", async () => {
    const harness = await mount()
    try {
      type("kanna")
      press("Enter")
      press("Enter")
      expect(useQuickSwitcherStore.getState().open).toBe(false)
    } finally {
      await harness.cleanup()
    }
  })

  test("renders without a React loop warning or a Radix accessibility error", async () => {
    const harness = await mount()
    try {
      expect(harness.loopWarnings).toEqual([])
      expect(harness.errors).toEqual([])
    } finally {
      await harness.cleanup()
    }
  })
})
