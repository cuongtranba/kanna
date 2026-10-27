import { expect, test } from "bun:test"
import { decodeInboundModelChoice, encodeInboundModelChoice } from "./handler"

test("a custom endpoint model id with a colon survives the encode and decode round trip", () => {
  const value = encodeInboundModelChoice("custom", "myendpoint/qwen3:32b")
  expect(decodeInboundModelChoice(value)).toEqual({ provider: "custom", model: "myendpoint/qwen3:32b" })
})

test("a model value naming an unknown provider or no model does not decode", () => {
  expect(decodeInboundModelChoice("mystery:some-model")).toBeNull()
  expect(decodeInboundModelChoice("claude:")).toBeNull()
  expect(decodeInboundModelChoice("")).toBeNull()
})
