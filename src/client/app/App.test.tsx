import { describe, expect, test } from "bun:test"
import { getAppAuthStateFromStatus, shouldPlayChatNotificationSound, shouldRedirectToChangelog } from "./App"
import { getChatNotificationSnapshot, getChatSoundBurstCount, getChatsNewlyWaiting, getNotificationTitle, getNotificationTitleCount } from "./chatNotifications"
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, clampSidebarWidth } from "./KannaSidebar"
import { isBrowserUnfocused, shouldPlayChatSound } from "../lib/chatSounds"
import { makeFakeDomPort } from "../adapters/testing/makeFakePorts"
import { EMPTY_CHAT_ACTIVITY } from "../../shared/types"
import type { AppSettingsSnapshot, SidebarChatRow, SidebarData } from "../../shared/types"

function createProjectGroup(chats: SidebarChatRow[]) {
  return {
    groupKey: "project-1",
    localPath: "/tmp/project",
    chats,
    previewChats: chats,
    olderChats: [],
    defaultCollapsed: false,
  }
}

describe("shouldRedirectToChangelog", () => {
  test("redirects only from the root route when the version is unseen", () => {
    expect(shouldRedirectToChangelog("/", "0.12.0", null)).toBe(true)
    expect(shouldRedirectToChangelog("/", "0.12.0", "0.11.0")).toBe(true)
    expect(shouldRedirectToChangelog("/settings/general", "0.12.0", "0.11.0")).toBe(false)
    expect(shouldRedirectToChangelog("/chat/1", "0.12.0", "0.11.0")).toBe(false)
    expect(shouldRedirectToChangelog("/", "0.12.0", "0.12.0")).toBe(false)
  })
})

describe("clampSidebarWidth", () => {
  test("keeps sidebar resizing within bounds", () => {
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 1)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 1)).toBe(MAX_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(333.6)).toBe(334)
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})

describe("auth boot helpers", () => {
  test("maps disabled or authenticated auth status to ready", () => {
    expect(getAppAuthStateFromStatus({ enabled: false, authenticated: true })).toEqual({ status: "ready" })
    expect(getAppAuthStateFromStatus({ enabled: true, authenticated: true })).toEqual({ status: "ready" })
  })

  test("maps enabled but unauthenticated auth status to locked", () => {
    expect(getAppAuthStateFromStatus({ enabled: true, authenticated: false })).toEqual({ status: "locked", error: null })
  })
})

describe("getNotificationTitleCount", () => {
  test("includes unread inbox threads", () => {
    expect(getNotificationTitleCount({ starredProjectGroups: [], projectGroups: [], stacks: [] }, 3)).toBe(3)
  })

  test("counts unread chats and waiting-for-user chats", () => {
    expect(getNotificationTitleCount({
      starredProjectGroups: [],
      projectGroups: [createProjectGroup([
          {
            _id: "chat-1",
            _creationTime: 1,
            chatId: "chat-1",
            title: "Unread",
            status: "idle",
            unread: true,
            localPath: "/tmp/project",
            provider: null,
            activity: EMPTY_CHAT_ACTIVITY,
          },
          {
            _id: "chat-2",
            _creationTime: 2,
            chatId: "chat-2",
            title: "Waiting",
            status: "waiting_for_user",
            unread: false,
            localPath: "/tmp/project",
            provider: null,
            activity: EMPTY_CHAT_ACTIVITY,
          },
          {
            _id: "chat-3",
            _creationTime: 3,
            chatId: "chat-3",
            title: "Both",
            status: "waiting_for_user",
            unread: true,
            localPath: "/tmp/project",
            provider: null,
            activity: EMPTY_CHAT_ACTIVITY,
          },
        ])],
      stacks: [],
    })).toBe(4)
  })
})

function createChatRow(chatId: string, overrides: Partial<SidebarChatRow> = {}): SidebarChatRow {
  return {
    _id: chatId,
    _creationTime: 1,
    chatId,
    title: chatId,
    status: "idle",
    unread: false,
    localPath: "/tmp/project",
    provider: null,
    activity: EMPTY_CHAT_ACTIVITY,
    ...overrides,
  }
}

function createSidebarData(chats: SidebarChatRow[]): SidebarData {
  return { starredProjectGroups: [], projectGroups: [createProjectGroup(chats)], stacks: [] }
}

describe("getNotificationTitle", () => {
  test("names the chat that is waiting for the user", () => {
    const data = createSidebarData([createChatRow("a", { title: "Ship the release", status: "waiting_for_user" })])
    expect(getNotificationTitle(data)).toBe("[1] Needs input: Ship the release · Kanna")
  })

  test("truncates a long waiting chat title", () => {
    const data = createSidebarData([createChatRow("a", { title: "x".repeat(60), status: "waiting_for_user" })])
    expect(getNotificationTitle(data)).toBe(`[1] Needs input: ${"x".repeat(40)}… · Kanna`)
  })

  test("summarises several waiting chats", () => {
    const data = createSidebarData([
      createChatRow("a", { status: "waiting_for_user" }),
      createChatRow("b", { status: "waiting_for_user", unread: true }),
    ])
    expect(getNotificationTitle(data)).toBe("[3] 2 chats need input · Kanna")
  })

  test("keeps the unread count when nothing is waiting", () => {
    expect(getNotificationTitle(createSidebarData([createChatRow("a", { unread: true })]))).toBe("[1] Kanna")
  })

  test("is the plain app name when nothing needs attention", () => {
    expect(getNotificationTitle(createSidebarData([createChatRow("a")]))).toBe("Kanna")
  })

  test("adds unread inbox threads to the count", () => {
    expect(getNotificationTitle(createSidebarData([createChatRow("a", { unread: true })]), 2)).toBe("[3] Kanna")
    expect(getNotificationTitle(createSidebarData([createChatRow("a")]), 4)).toBe("[4] Kanna")
  })
})

describe("getChatsNewlyWaiting", () => {
  test("reports nothing on the first snapshot", () => {
    expect(getChatsNewlyWaiting(null, createSidebarData([createChatRow("a", { status: "waiting_for_user" })]))).toEqual([])
  })

  test("reports only chats that just entered waiting", () => {
    const previous = createSidebarData([createChatRow("a", { status: "waiting_for_user" }), createChatRow("b")])
    const next = createSidebarData([
      createChatRow("a", { status: "waiting_for_user" }),
      createChatRow("b", { status: "waiting_for_user" }),
    ])
    expect(getChatsNewlyWaiting(previous, next)).toEqual(["b"])
  })
})

describe("chat sound helpers", () => {
  const previous = {
    starredProjectGroups: [],
    projectGroups: [createProjectGroup([{
        _id: "chat-1",
        _creationTime: 1,
        chatId: "chat-1",
        title: "Read",
        status: "idle" as const,
        unread: false,
        localPath: "/tmp/project",
        provider: null,
        activity: EMPTY_CHAT_ACTIVITY,
      }])],
    stacks: [],
  }

  test("extracts unread and waiting notification state", () => {
    const snapshot = getChatNotificationSnapshot({
      starredProjectGroups: [],
      projectGroups: [createProjectGroup([
          {
            _id: "chat-1",
            _creationTime: 1,
            chatId: "chat-1",
            title: "Unread",
            status: "idle",
            unread: true,
            localPath: "/tmp/project",
            provider: null,
            activity: EMPTY_CHAT_ACTIVITY,
          },
          {
            _id: "chat-2",
            _creationTime: 2,
            chatId: "chat-2",
            title: "Waiting",
            status: "waiting_for_user",
            unread: false,
            localPath: "/tmp/project",
            provider: null,
            activity: EMPTY_CHAT_ACTIVITY,
          },
        ])],
      stacks: [],
    })

    expect(snapshot.unreadCount).toBe(1)
    expect([...snapshot.waitingChatIds]).toEqual(["chat-2"])
  })

  test("does not play on initial snapshot hydration", () => {
    expect(getChatSoundBurstCount(null, previous)).toBe(0)
  })

  test("plays per unread increment and new waiting chat", () => {
    expect(getChatSoundBurstCount(previous, {
      starredProjectGroups: [],
      projectGroups: [createProjectGroup([
          {
            _id: "chat-1",
            _creationTime: 1,
            chatId: "chat-1",
            title: "Unread",
            status: "idle",
            unread: true,
            localPath: "/tmp/project",
            provider: null,
            activity: EMPTY_CHAT_ACTIVITY,
          },
          {
            _id: "chat-2",
            _creationTime: 2,
            chatId: "chat-2",
            title: "Waiting",
            status: "waiting_for_user",
            unread: true,
            localPath: "/tmp/project",
            provider: null,
            activity: EMPTY_CHAT_ACTIVITY,
          },
        ])],
      stacks: [],
    })).toBe(3)
  })

  test("does not replay for an already-waiting chat", () => {
    const current = {
      starredProjectGroups: [],
      projectGroups: [createProjectGroup([{
          _id: "chat-1",
          _creationTime: 1,
          chatId: "chat-1",
          title: "Waiting",
          status: "waiting_for_user" as const,
          unread: false,
          localPath: "/tmp/project",
          provider: null,
          activity: EMPTY_CHAT_ACTIVITY,
        }])],
      stacks: [],
    }

    expect(getChatSoundBurstCount(current, current)).toBe(0)
  })

  test("treats hidden or blurred pages as unfocused", () => {
    expect(isBrowserUnfocused(makeFakeDomPort({
      visibilityState: "hidden",
      focused: true,
    }))).toBe(true)
    expect(isBrowserUnfocused(makeFakeDomPort({
      visibilityState: "visible",
      focused: false,
    }))).toBe(true)
    expect(isBrowserUnfocused(makeFakeDomPort({
      visibilityState: "visible",
      focused: true,
    }))).toBe(false)
  })

  test("applies chat sound preference gates", () => {
    const focusedDom = makeFakeDomPort({ visibilityState: "visible", focused: true })
    const hiddenDom = makeFakeDomPort({ visibilityState: "hidden", focused: false })

    expect(shouldPlayChatSound("never", hiddenDom)).toBe(false)
    expect(shouldPlayChatSound("always", focusedDom)).toBe(true)
    expect(shouldPlayChatSound("unfocused", hiddenDom)).toBe(true)
    expect(shouldPlayChatSound("unfocused", focusedDom)).toBe(false)
  })

  test("blocks notification sounds until app settings are hydrated", () => {
    const hiddenDom = makeFakeDomPort({ visibilityState: "hidden", focused: false })

    expect(shouldPlayChatNotificationSound(null, "always", hiddenDom)).toBe(false)
    expect(shouldPlayChatNotificationSound({} as AppSettingsSnapshot, "never", hiddenDom)).toBe(false)
    expect(shouldPlayChatNotificationSound({} as AppSettingsSnapshot, "always", hiddenDom)).toBe(true)
  })
})
