import { expect, test } from "vite-plus/test"
import { AGENT_PROVIDERS } from "../core-types"
import { providerAllowsAuto } from "./autonomy"

test("Auto-send is offered only to handlers whose tool calls Kanna can stop", () => {
  const allowed = AGENT_PROVIDERS.filter((provider) => providerAllowsAuto(provider))

  expect(allowed).toEqual(["claude", "openrouter", "custom"])
  expect(providerAllowsAuto(undefined)).toBe(true)
})
