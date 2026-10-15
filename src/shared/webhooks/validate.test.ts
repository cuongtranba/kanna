import { expect, test } from "bun:test"
import { validateWebhookInput } from "./validate"

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
