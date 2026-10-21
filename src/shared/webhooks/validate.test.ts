import { expect, test } from "bun:test"
import { PROVIDERS } from "../types"
import type { WebhookInput, WebhookSlackInput } from "./types"
import { validateSlackHookFields } from "./slack"
import { validateWebhookInput, validateWebhookModel } from "./validate"

test("a notify or inline hook needs a chat and a spawn hook needs a project", () => {
  expect(validateWebhookInput({ name: "ci", mode: "notify", template: "t" })).toHaveLength(1)
  expect(validateWebhookInput({ name: "ci", mode: "inline", template: "t" })).toHaveLength(1)
  expect(validateWebhookInput({ name: "ci", mode: "spawn", chatId: "c", template: "t" })).toHaveLength(1)
  expect(validateWebhookInput({ name: "ci", mode: "spawn", projectId: "p", template: "t" })).toEqual([])
  expect(validateWebhookInput({ name: "ci", mode: "notify", chatId: "c", template: "t" })).toEqual([])
})

test("an empty name or template and an over-long name are all reported", () => {
  const errors = validateWebhookInput({ name: " ", mode: "notify", chatId: "c", template: "" })
  expect(errors).toHaveLength(2)
  expect(validateWebhookInput({ name: "x".repeat(81), mode: "notify", chatId: "c", template: "t" })).toHaveLength(1)
})

const claude = PROVIDERS.find((entry) => entry.id === "claude")
const openrouter = PROVIDERS.find((entry) => entry.id === "openrouter")
if (!claude || !openrouter) throw new Error("built-in catalog is missing a provider")
const claudeModel = claude.models[0].id

test("a model the provider catalog offers is accepted and an unknown one is rejected", () => {
  expect(validateWebhookModel({ provider: "claude", model: claudeModel }, PROVIDERS)).toEqual([])
  expect(validateWebhookModel({ provider: "claude", model: "not-a-model" }, PROVIDERS)).toHaveLength(1)
})

test("a provider without a model, or a model without a provider, is rejected; neither is fine", () => {
  expect(validateWebhookModel({ provider: "claude" }, PROVIDERS)).toHaveLength(1)
  expect(validateWebhookModel({ model: claudeModel }, PROVIDERS)).toHaveLength(1)
  expect(validateWebhookModel({}, PROVIDERS)).toEqual([])
  expect(validateWebhookModel({ provider: null, model: null }, PROVIDERS)).toEqual([])
})

test("an openrouter model id is free-form because its catalog is dynamic", () => {
  expect(validateWebhookModel({ provider: "openrouter", model: "vendor/some-model:nitro" }, PROVIDERS)).toEqual([])
  expect(validateWebhookModel({ provider: "openrouter", model: "x".repeat(201) }, PROVIDERS)).toHaveLength(1)
})

const SLACK_CREDENTIALS: WebhookSlackInput = { allowedUserIds: ["UOWNER000"], signingSecret: "secret", botToken: "xoxb-token" }
const SLACK: WebhookInput = {
  name: "slack",
  kind: "slack",
  mode: "spawn",
  projectId: "p",
  template: "",
  slack: SLACK_CREDENTIALS,
}

test("a Slack hook needs spawn mode and a project but not a template", () => {
  expect(validateWebhookInput(SLACK)).toEqual([])
  expect(validateWebhookInput({ ...SLACK, mode: "inline", chatId: "c" })).toHaveLength(1)
  expect(validateWebhookInput({ ...SLACK, projectId: undefined })).toHaveLength(1)
  expect(validateWebhookInput({ ...SLACK, filter: "on: issues" })).toHaveLength(1)
})

test("Slack credentials must look like Slack's and the allowlist must hold one to ten user IDs", () => {
  const withSlack = (slack: Partial<WebhookSlackInput>) => validateWebhookInput({ ...SLACK, slack: { ...SLACK_CREDENTIALS, ...slack } })
  expect(withSlack({ botToken: "xoxp-user" })).toHaveLength(1)
  expect(withSlack({ signingSecret: " " })).toHaveLength(1)
  expect(withSlack({ allowedUserIds: [] })).toHaveLength(1)
  expect(withSlack({ allowedUserIds: ["not-an-id"] })).toHaveLength(1)
  expect(withSlack({ allowedUserIds: Array.from({ length: 11 }, (_, index) => `U00000${index}A`) })).toHaveLength(1)
  expect(withSlack({ allowedUserIds: ["W0ENTERPR1"] })).toEqual([])
})

test("when editing, blank Slack secrets are allowed because the saved ones are kept", () => {
  expect(validateSlackHookFields({ allowedUserIds: ["UOWNER000"], signingSecret: "", botToken: "" }, { requireSecrets: false })).toEqual([])
  expect(validateSlackHookFields({ allowedUserIds: ["UOWNER000"] }, { requireSecrets: true })).toHaveLength(2)
  expect(validateSlackHookFields({ botToken: "wrong" }, { requireSecrets: false })).toHaveLength(1)
})
