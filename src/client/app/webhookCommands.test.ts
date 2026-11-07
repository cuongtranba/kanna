import { expect, test } from "vite-plus/test"
import { revealCreatedWebhookSecret } from "./webhookCommands"

test("creating a hook reveals its secret and refuses a reply without one", () => {
  expect(revealCreatedWebhookSecret({ hook: { id: "h1", name: "CI" }, secret: "kwh_x" })).toEqual({
    hookId: "h1",
    hookName: "CI",
    secret: "kwh_x",
  })
  expect(() => revealCreatedWebhookSecret({ hook: { id: "h1", name: "CI" }, secret: null })).toThrow()
})
