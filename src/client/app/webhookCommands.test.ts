import { expect, test } from "vite-plus/test"
import { revealCreatedWebhookSecret } from "./webhookCommands"

test("creating a Slack hook succeeds without a secret to reveal", () => {
  expect(revealCreatedWebhookSecret({ hook: { id: "h1", name: "Slack", kind: "slack" }, secret: null })).toBeNull()
})

test("creating a generic hook reveals its secret and refuses a reply without one", () => {
  expect(revealCreatedWebhookSecret({ hook: { id: "h1", name: "CI", kind: "generic" }, secret: "kwh_x" })).toEqual({
    hookId: "h1",
    hookName: "CI",
    secret: "kwh_x",
  })
  expect(() => revealCreatedWebhookSecret({ hook: { id: "h1", name: "CI", kind: "generic" }, secret: null })).toThrow()
})
