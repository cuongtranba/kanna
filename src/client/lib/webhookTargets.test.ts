import { expect, test } from "vite-plus/test"
import type { SidebarData } from "../../shared/types"
import { decodeWebhookModel, encodeWebhookModel, describeWebhookTarget, listWebhookTargets } from "./webhookTargets"

const SIDEBAR: SidebarData = {
  starredProjectGroups: [],
  stacks: [],
  projectGroups: [
    {
      groupKey: "project-1",
      localPath: "/work/kanna",
      defaultCollapsed: false,
      previewChats: [],
      olderChats: [],
      chats: [
        {
          _id: "c1",
          _creationTime: 1,
          chatId: "chat-1",
          title: "Fix CI",
          status: "idle",
          unread: false,
          localPath: "/work/kanna",
          provider: null,
          activity: { agents: 0, workflow: null, loop: null, backgroundTasks: 0, cron: null, awaitingAnswer: false, lastRunFailure: null },
        },
      ],
    },
  ],
}

test("a target is described by its project and chat names, and a vanished one says so", () => {
  const targets = listWebhookTargets(SIDEBAR)
  const base = { id: "h", name: "n", enabled: true, kind: "generic" as const, template: "t", createdAt: 1, updatedAt: 1 }
  expect(describeWebhookTarget({ ...base, mode: "inline", chatId: "chat-1" }, targets)).toBe("kanna / Fix CI")
  expect(describeWebhookTarget({ ...base, mode: "spawn", projectId: "project-1" }, targets)).toBe("New chat in kanna")
  expect(describeWebhookTarget({ ...base, mode: "notify", chatId: "gone" }, targets)).toBe("Chat no longer available")
})

test("a custom endpoint model id with a colon survives the encode and decode round trip", () => {
  const value = encodeWebhookModel("custom", "myendpoint/qwen3:32b")
  expect(decodeWebhookModel(value)).toEqual({ provider: "custom", model: "myendpoint/qwen3:32b" })
})

test("a model value naming an unknown provider or no model does not decode", () => {
  expect(decodeWebhookModel("mystery:some-model")).toBeNull()
  expect(decodeWebhookModel("claude:")).toBeNull()
  expect(decodeWebhookModel("")).toBeNull()
})

test("projects and chats carry the project path as a searchable hint", () => {
  const targets = listWebhookTargets(SIDEBAR)
  expect(targets.projects[0].hint).toBe("/work/kanna")
  expect(targets.chats[0].hint).toBe("/work/kanna")
})
