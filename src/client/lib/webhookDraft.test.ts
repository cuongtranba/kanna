import { expect, test } from "vite-plus/test"
import { buildWebhookInput, buildWebhookPatch, type WebhookDraftFields } from "./webhookDraft"

const DRAFT: WebhookDraftFields = {
  name: "CI",
  mode: "inline",
  handling: "triage",
  chatId: "chat-1",
  projectId: "project-1",
  modelValue: "",
  template: "t",
  filter: "on: push",
  threadKeyPath: "a.b",
  senderPath: "c.d",
  replyHint: "hint",
}

test("a draft keeps its mode and optional fields", () => {
  expect(buildWebhookInput(DRAFT)).toEqual({
    name: "CI",
    mode: "inline",
    template: "t",
    chatId: "chat-1",
    filter: "on: push",
    threadKeyPath: "a.b",
    senderPath: "c.d",
    replyHint: "hint",
  })
})

test("a task handling reaches only hooks that start a turn, and a patch clears it otherwise", () => {
  const task: WebhookDraftFields = { ...DRAFT, handling: "task" }
  expect(buildWebhookInput(task).handling).toBe("task")
  expect(buildWebhookPatch(buildWebhookInput(task)).handling).toBe("task")
  expect(buildWebhookInput({ ...task, mode: "notify" }).handling).toBeUndefined()
  expect(buildWebhookPatch(buildWebhookInput(DRAFT)).handling).toBeNull()
})
