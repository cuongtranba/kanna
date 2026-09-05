import { describe, expect, test } from "bun:test"
import {
  applySidebarProjectOrder,
  getNewestRemainingChatId,
  getMostRecentProjectProvider,
  getProjectIdForChat,
  getUiUpdateRestartReconnectAction,
  deriveUiRestartActivity,
  shouldHandleUiUpdateReloadRequest,
  resolveComposeIntent,
  getUiUpdateReadinessPath,
} from "./useAppGlobalState"
import type { SidebarData } from "../../shared/types"

type SidebarGroup = SidebarData["projectGroups"][number]
type SidebarChat = SidebarGroup["chats"][number]


function makeProjectGroup(groupKey: string, chatIds: string[] = []): SidebarGroup {
  return {
    groupKey,
    localPath: `/projects/${groupKey}`,
    chats: chatIds.map((chatId) => ({ chatId } as unknown as SidebarChat)),
    previewChats: [],
    olderChats: [],
    defaultCollapsed: false,
  }
}


describe("applySidebarProjectOrder", () => {
  test("returns original groups unchanged when no projectIds given", () => {
    const groups = [makeProjectGroup("a"), makeProjectGroup("b")]
    expect(applySidebarProjectOrder(groups, null)).toBe(groups)
  })

  test("returns original groups when empty projectIds", () => {
    const groups = [makeProjectGroup("a"), makeProjectGroup("b")]
    expect(applySidebarProjectOrder(groups, [])).toBe(groups)
  })

  test("returns original groups when only one group", () => {
    const groups = [makeProjectGroup("a")]
    expect(applySidebarProjectOrder(groups, ["b", "a"])).toBe(groups)
  })

  test("reorders groups according to projectIds", () => {
    const groups = [makeProjectGroup("a"), makeProjectGroup("b"), makeProjectGroup("c")]
    const result = applySidebarProjectOrder(groups, ["c", "a", "b"])
    expect(result.map((g) => g.groupKey)).toEqual(["c", "a", "b"])
  })

  test("unknown projectIds are skipped", () => {
    const groups = [makeProjectGroup("a"), makeProjectGroup("b")]
    const result = applySidebarProjectOrder(groups, ["z", "b", "a"])
    expect(result.map((g) => g.groupKey)).toEqual(["b", "a"])
  })

  test("projects not in order list are appended after ordered ones", () => {
    const groups = [makeProjectGroup("a"), makeProjectGroup("b"), makeProjectGroup("c")]
    const result = applySidebarProjectOrder(groups, ["c"])
    expect(result.map((g) => g.groupKey)).toEqual(["c", "a", "b"])
  })

  test("returns original reference when order matches existing order", () => {
    const groups = [makeProjectGroup("a"), makeProjectGroup("b")]
    const result = applySidebarProjectOrder(groups, ["a", "b"])
    expect(result).toBe(groups)
  })

  test("returns original groups when all projectIds are unknown", () => {
    const groups = [makeProjectGroup("a"), makeProjectGroup("b")]
    const result = applySidebarProjectOrder(groups, ["x", "y"])
    expect(result).toBe(groups)
  })

  test("deduplicates repeated projectIds", () => {
    const groups = [makeProjectGroup("a"), makeProjectGroup("b")]
    const result = applySidebarProjectOrder(groups, ["a", "a", "b"])
    expect(result.map((g) => g.groupKey)).toEqual(["a", "b"])
  })
})


describe("getNewestRemainingChatId", () => {
  test("returns null when activeChatId not found in any group", () => {
    const groups = [makeProjectGroup("p", ["a", "b"])]
    expect(getNewestRemainingChatId(groups, "x")).toBeNull()
  })

  test("returns the next chat in the group when available", () => {
    const groups = [makeProjectGroup("p", ["a", "b", "c"])]
    expect(getNewestRemainingChatId(groups, "a")).toBe("b")
  })

  test("returns null when the only chat in the group is removed", () => {
    const groups = [makeProjectGroup("p", ["only"])]
    expect(getNewestRemainingChatId(groups, "only")).toBeNull()
  })

  test("returns a sibling from the correct project group", () => {
    const groups = [makeProjectGroup("p1", ["a"]), makeProjectGroup("p2", ["b", "c"])]
    expect(getNewestRemainingChatId(groups, "b")).toBe("c")
  })
})


describe("getProjectIdForChat", () => {
  test("returns null for null chatId", () => {
    const groups = [makeProjectGroup("p", ["a"])]
    expect(getProjectIdForChat(groups, null)).toBeNull()
  })

  test("returns the groupKey when chat is found", () => {
    const groups = [makeProjectGroup("proj-1", ["chat-a"]), makeProjectGroup("proj-2", ["chat-b"])]
    expect(getProjectIdForChat(groups, "chat-b")).toBe("proj-2")
  })

  test("returns null when chatId not found", () => {
    const groups = [makeProjectGroup("p", ["a"])]
    expect(getProjectIdForChat(groups, "missing")).toBeNull()
  })

  test("returns null for empty groups", () => {
    expect(getProjectIdForChat([], "a")).toBeNull()
  })
})


describe("getUiUpdateRestartReconnectAction", () => {
  test("returns awaiting_server_ready when phase=awaiting_disconnect and status=disconnected", () => {
    expect(getUiUpdateRestartReconnectAction("awaiting_disconnect", "disconnected")).toBe("awaiting_server_ready")
  })

  test("returns none when phase=awaiting_disconnect and status=connected", () => {
    expect(getUiUpdateRestartReconnectAction("awaiting_disconnect", "connected")).toBe("none")
  })

  test("returns none when phase=null", () => {
    expect(getUiUpdateRestartReconnectAction(null, "disconnected")).toBe("none")
  })

  test("returns none when phase=awaiting_server_ready (already advanced)", () => {
    expect(getUiUpdateRestartReconnectAction("awaiting_server_ready", "disconnected")).toBe("none")
  })

  test("returns none when phase=idle", () => {
    expect(getUiUpdateRestartReconnectAction("idle", "disconnected")).toBe("none")
  })
})


describe("deriveUiRestartActivity", () => {
  test("inactive and empty label when phase=null and status=null", () => {
    const result = deriveUiRestartActivity(null, null)
    expect(result.active).toBe(false)
    expect(result.label).toBe("")
  })

  test("active with 'Installing update' when updateStatus=updating", () => {
    const result = deriveUiRestartActivity(null, "updating")
    expect(result.active).toBe(true)
    expect(result.label).toBe("Installing update")
  })

  test("active with 'Installing update' when updateStatus=restart_pending", () => {
    const result = deriveUiRestartActivity(null, "restart_pending")
    expect(result.active).toBe(true)
    expect(result.label).toBe("Installing update")
  })

  test("active with 'Re-deploying Kanna' when phase=awaiting_disconnect", () => {
    const result = deriveUiRestartActivity("awaiting_disconnect", null)
    expect(result.active).toBe(true)
    expect(result.label).toBe("Re-deploying Kanna")
  })

  test("active with 'Re-deploying Kanna' when phase=awaiting_server_ready", () => {
    const result = deriveUiRestartActivity("awaiting_server_ready", null)
    expect(result.active).toBe(true)
    expect(result.label).toBe("Re-deploying Kanna")
  })

  test("update status takes precedence over phase for label", () => {
    const result = deriveUiRestartActivity("awaiting_disconnect", "updating")
    expect(result.label).toBe("Installing update")
  })

  test("inactive when phase=idle and no update status", () => {
    const result = deriveUiRestartActivity("idle", null)
    expect(result.active).toBe(false)
  })
})


describe("shouldHandleUiUpdateReloadRequest", () => {
  test("returns false when reloadRequestedAt is null", () => {
    expect(shouldHandleUiUpdateReloadRequest(null, null)).toBe(false)
  })

  test("returns false when reloadRequestedAt is undefined", () => {
    expect(shouldHandleUiUpdateReloadRequest(undefined, null)).toBe(false)
  })

  test("returns true when lastHandled is null", () => {
    expect(shouldHandleUiUpdateReloadRequest(1234, null)).toBe(true)
  })

  test("returns false when reloadRequestedAt matches lastHandled as string", () => {
    expect(shouldHandleUiUpdateReloadRequest(1234, "1234")).toBe(false)
  })

  test("returns true when reloadRequestedAt differs from lastHandled", () => {
    expect(shouldHandleUiUpdateReloadRequest(5678, "1234")).toBe(true)
  })

  test("returns false when both are zero", () => {
    expect(shouldHandleUiUpdateReloadRequest(0, "0")).toBe(false)
  })
})


describe("resolveComposeIntent", () => {
  test("returns project_id intent when selectedProjectId is set", () => {
    const result = resolveComposeIntent({ selectedProjectId: "p1" })
    expect(result).toEqual({ kind: "project_id", projectId: "p1" })
  })

  test("selectedProjectId takes precedence over sidebarProjectId", () => {
    const result = resolveComposeIntent({ selectedProjectId: "p1", sidebarProjectId: "p2" })
    expect(result).toEqual({ kind: "project_id", projectId: "p1" })
  })

  test("uses sidebarProjectId when selectedProjectId is null", () => {
    const result = resolveComposeIntent({ selectedProjectId: null, sidebarProjectId: "p2" })
    expect(result).toEqual({ kind: "project_id", projectId: "p2" })
  })

  test("uses fallbackLocalProjectPath when no project id available", () => {
    const result = resolveComposeIntent({ selectedProjectId: null, fallbackLocalProjectPath: "/my/project" })
    expect(result).toEqual({ kind: "local_path", localPath: "/my/project" })
  })

  test("returns null when nothing is available", () => {
    expect(resolveComposeIntent({ selectedProjectId: null })).toBeNull()
  })

  test("returns null when all are null/undefined", () => {
    expect(resolveComposeIntent({ selectedProjectId: null, sidebarProjectId: null, fallbackLocalProjectPath: null })).toBeNull()
  })
})


describe("getUiUpdateReadinessPath", () => {
  test("returns /auth/status", () => {
    expect(getUiUpdateReadinessPath()).toBe("/auth/status")
  })
})


describe("getMostRecentProjectProvider", () => {
  test("returns null when project group is not found", () => {
    const groups = [makeProjectGroup("proj-a")]
    expect(getMostRecentProjectProvider(groups, "proj-missing")).toBeNull()
  })

  test("returns null when the project has no chats", () => {
    const groups = [makeProjectGroup("proj-a", [])]
    expect(getMostRecentProjectProvider(groups, "proj-a")).toBeNull()
  })

  test("returns null when the most recent chat has no provider", () => {
    const group: SidebarGroup = {
      groupKey: "proj-a",
      localPath: "/projects/proj-a",
      chats: [{ chatId: "c1", provider: null } as unknown as SidebarChat],
      previewChats: [],
      olderChats: [],
      defaultCollapsed: false,
    }
    expect(getMostRecentProjectProvider([group], "proj-a")).toBeNull()
  })

  test("returns the provider of the most recent (first) chat", () => {
    const group: SidebarGroup = {
      groupKey: "proj-a",
      localPath: "/projects/proj-a",
      chats: [
        { chatId: "c1", provider: "codex" } as unknown as SidebarChat,
        { chatId: "c2", provider: "claude" } as unknown as SidebarChat,
      ],
      previewChats: [],
      olderChats: [],
      defaultCollapsed: false,
    }
    expect(getMostRecentProjectProvider([group], "proj-a")).toBe("codex")
  })

  test("returns claude when the most recent chat used claude", () => {
    const group: SidebarGroup = {
      groupKey: "proj-b",
      localPath: "/projects/proj-b",
      chats: [
        { chatId: "c1", provider: "claude" } as unknown as SidebarChat,
        { chatId: "c2", provider: "codex" } as unknown as SidebarChat,
      ],
      previewChats: [],
      olderChats: [],
      defaultCollapsed: false,
    }
    expect(getMostRecentProjectProvider([group], "proj-b")).toBe("claude")
  })

  test("returns sourceProvider when all chats have null provider", () => {
    const group: SidebarGroup = {
      groupKey: "proj-c",
      localPath: "/projects/proj-c",
      chats: [{ chatId: "c1", provider: null } as unknown as SidebarChat],
      previewChats: [],
      olderChats: [],
      defaultCollapsed: false,
      sourceProvider: "codex",
    }
    expect(getMostRecentProjectProvider([group], "proj-c")).toBe("codex")
  })

  test("returns sourceProvider when the project has no chats", () => {
    const group: SidebarGroup = {
      groupKey: "proj-d",
      localPath: "/projects/proj-d",
      chats: [],
      previewChats: [],
      olderChats: [],
      defaultCollapsed: false,
      sourceProvider: "codex",
    }
    expect(getMostRecentProjectProvider([group], "proj-d")).toBe("codex")
  })

  test("prefers first chat provider over sourceProvider", () => {
    const group: SidebarGroup = {
      groupKey: "proj-e",
      localPath: "/projects/proj-e",
      chats: [
        { chatId: "c1", provider: "claude" } as unknown as SidebarChat,
      ],
      previewChats: [],
      olderChats: [],
      defaultCollapsed: false,
      sourceProvider: "codex",
    }
    expect(getMostRecentProjectProvider([group], "proj-e")).toBe("claude")
  })

  test("skips null-provider chats to find first chat with a provider", () => {
    const group: SidebarGroup = {
      groupKey: "proj-f",
      localPath: "/projects/proj-f",
      chats: [
        { chatId: "c1", provider: null } as unknown as SidebarChat,
        { chatId: "c2", provider: "codex" } as unknown as SidebarChat,
      ],
      previewChats: [],
      olderChats: [],
      defaultCollapsed: false,
    }
    expect(getMostRecentProjectProvider([group], "proj-f")).toBe("codex")
  })
})
