import { expect, test } from "bun:test"
import { buildWebhookInput, buildWebhookPatch, parseSlackMemberIds, validateWebhookDraft, type WebhookDraftFields } from "./webhookDraft"

const SLACK_DRAFT: WebhookDraftFields = {
  name: "Slack",
  kind: "slack",
  mode: "notify",
  chatId: "chat-1",
  projectId: "project-1",
  modelValue: "",
  template: "",
  filter: "on: push",
  threadKeyPath: "a.b",
  senderPath: "c.d",
  replyHint: "hint",
  signingSecret: " test-signing-secret ",
  botToken: "xoxb-test",
  allowedUserIds: "u01abcdef, U02GHIJKL u01abcdef",
}

test("a Slack draft builds a spawn-mode project hook with trimmed secrets, deduped upper-case member IDs and no generic fields", () => {
  const input = buildWebhookInput(SLACK_DRAFT)
  expect(input).toEqual({
    name: "Slack",
    kind: "slack",
    mode: "spawn",
    projectId: "project-1",
    template: "",
    slack: { allowedUserIds: ["U01ABCDEF", "U02GHIJKL"], signingSecret: "test-signing-secret", botToken: "xoxb-test" },
  })
  expect(validateWebhookDraft(input, [], false)).toEqual([])
})

test("editing a Slack hook accepts blank secrets and the patch leaves the saved ones untouched", () => {
  const input = buildWebhookInput({ ...SLACK_DRAFT, signingSecret: "", botToken: "" })
  expect(validateWebhookDraft(input, [], true)).toEqual([])
  expect(validateWebhookDraft(input, [], false)).toContain("Slack signing secret is required")
  expect(buildWebhookPatch(input).slack).toEqual({ allowedUserIds: ["U01ABCDEF", "U02GHIJKL"] })
  expect(buildWebhookPatch(buildWebhookInput({ ...SLACK_DRAFT, botToken: "xoxb-new" })).slack).toEqual({
    allowedUserIds: ["U01ABCDEF", "U02GHIJKL"],
    signingSecret: "test-signing-secret",
    botToken: "xoxb-new",
  })
})

test("member IDs split on commas and whitespace", () => {
  expect(parseSlackMemberIds("U01ABCDEF,\nU02GHIJKL  ;")).toEqual(["U01ABCDEF", "U02GHIJKL"])
})

test("a generic draft keeps its mode and optional fields and sends no Slack block", () => {
  const input = buildWebhookInput({ ...SLACK_DRAFT, kind: "generic", mode: "inline", template: "t" })
  expect(input).toEqual({
    name: "Slack",
    mode: "inline",
    template: "t",
    chatId: "chat-1",
    filter: "on: push",
    threadKeyPath: "a.b",
    senderPath: "c.d",
    replyHint: "hint",
  })
})
