import { expect, test } from "vite-plus/test"
import { outboundTextViolations } from "./outbound-text"

const RULES = { allowUrls: false, maxChars: 100 }

test("plain text passes", () => {
  expect(outboundTextViolations("Thanks, the invoice is paid.", RULES)).toEqual([])
})

test("a URL is flagged unless the source allows URLs", () => {
  expect(outboundTextViolations("See https://example.com/pay", RULES)).toEqual(["contains a URL"])
  expect(outboundTextViolations("See www.example.com", RULES)).toEqual(["contains a URL"])
  expect(outboundTextViolations("See https://example.com/pay", { ...RULES, allowUrls: true })).toEqual([])
})

test("markdown images and links are flagged even when URLs are allowed", () => {
  const rules = { ...RULES, allowUrls: true }
  expect(outboundTextViolations("![logo](https://example.com/a.png)", rules)).toContain("contains a markdown image")
  expect(outboundTextViolations("[pay here](https://example.com)", rules)).toEqual(["contains a markdown link"])
})

test("HTML tags are flagged but a comparison is not", () => {
  expect(outboundTextViolations("Click <a href='x'>here</a>", RULES)).toEqual(["contains HTML"])
  expect(outboundTextViolations("3 < 5 and 7 > 2", RULES)).toEqual([])
})

test("text over the limit is flagged", () => {
  expect(outboundTextViolations("x".repeat(101), RULES)).toEqual(["is longer than 100 characters"])
  expect(outboundTextViolations("x".repeat(100), RULES)).toEqual([])
})
