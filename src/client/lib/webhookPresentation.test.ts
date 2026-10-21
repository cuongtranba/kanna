import { expect, test } from "bun:test"
import { bearerCurlSample, describeLastDelivery, hmacCurlSample, isPublicHttpsOrigin, webhookUrl } from "./webhookPresentation"

test("the sample commands target the hook url and carry the secret", () => {
  const url = webhookUrl("http://localhost:5175", "abcdefgh12345678")
  expect(url).toBe("http://localhost:5175/hooks/abcdefgh12345678")
  expect(bearerCurlSample(url, "kwh_x")).toContain("Authorization: Bearer kwh_x")
  expect(hmacCurlSample(url, "kwh_x")).toContain("openssl dgst -sha256 -hmac 'kwh_x'")
  expect(hmacCurlSample(url, "kwh_x")).toContain(url)
})

test("a filtered delivery reads as Filtered with its reason rather than Delivered", () => {
  const text = describeLastDelivery({ at: 0, ok: true, status: 200, filtered: true, detail: 'filtered: event "push" not in on' })
  expect(text.startsWith('Filtered (event "push" not in on) at ')).toBe(true)
})

test("only a public https origin counts as reachable by Slack", () => {
  expect(isPublicHttpsOrigin("https://kanna.example.com")).toBe(true)
  expect(isPublicHttpsOrigin("http://localhost:5175")).toBe(false)
  expect(isPublicHttpsOrigin("https://127.0.0.1:5175")).toBe(false)
  expect(isPublicHttpsOrigin("http://192.168.1.5:5175")).toBe(false)
})
