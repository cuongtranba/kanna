import { describe, expect, test } from "bun:test"
import { getAppAuthStateFromStatus, shouldPlayChatNotificationSound, shouldRedirectToChangelog, shouldRetryAuthStatusRequest } from "./App"
import { getChatNotificationSnapshot, getChatSoundBurstCount, getNotificationTitleCount } from "./chatNotifications"
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, clampSidebarWidth } from "./KannaSidebar"
import { isBrowserUnfocused, shouldPlayChatSound } from "../lib/chatSounds"
import { makeFakeDomPort } from "../adapters/testing/makeFakePorts"
import type { AppSettingsSnapshot, SidebarChatRow } from "../../shared/types"

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

  test("retries auth status requests unless the endpoint returned ok", () => {
    expect(shouldRetryAuthStatusRequest(null)).toBe(true)
    expect(shouldRetryAuthStatusRequest(false)).toBe(true)
    expect(shouldRetryAuthStatusRequest(true)).toBe(false)
  })
})

describe("getNotificationTitleCount", () => {
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
            hasAutomation: false,
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
            hasAutomation: false,
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
            hasAutomation: false,
          },
        ])],
      stacks: [],
    })).toBe(4)
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
        hasAutomation: false,
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
            hasAutomation: false,
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
            hasAutomation: false,
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
            hasAutomation: false,
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
            hasAutomation: false,
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
          hasAutomation: false,
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
