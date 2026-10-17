import { expect, test } from "bun:test"
import { PROVIDERS } from "../types"
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
