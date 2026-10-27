import { expect, test } from "vite-plus/test"
import { signSlack } from "../../test-helpers/slack-harness"
import { verifySlackSignature } from "./slack-signature"

const SECRET = "slack-signing-secret"
const BODY = JSON.stringify({ type: "event_callback", event_id: "Ev1" })
const NOW_SECONDS = 1_700_000_000
const raw = (text: string) => new TextEncoder().encode(text)

test("a request signed with the secret inside the freshness window is accepted", () => {
  const headers = new Headers(signSlack(SECRET, BODY, NOW_SECONDS))
  expect(verifySlackSignature(SECRET, headers, raw(BODY), NOW_SECONDS * 1000)).toBe("ok")
  expect(verifySlackSignature(SECRET, headers, raw(BODY), (NOW_SECONDS + 299) * 1000)).toBe("ok")
})

test("a replayed request older than five minutes is refused even with a valid signature", () => {
  const headers = new Headers(signSlack(SECRET, BODY, NOW_SECONDS))
  expect(verifySlackSignature(SECRET, headers, raw(BODY), (NOW_SECONDS + 301) * 1000)).toBe("unauthorized")
})

test("a tampered body, a wrong secret and a missing or malformed signature are refused", () => {
  const headers = new Headers(signSlack(SECRET, BODY, NOW_SECONDS))
  const now = NOW_SECONDS * 1000
  expect(verifySlackSignature(SECRET, headers, raw(BODY.replace("Ev1", "Ev2")), now)).toBe("unauthorized")
  expect(verifySlackSignature("another-secret", headers, raw(BODY), now)).toBe("unauthorized")
  expect(verifySlackSignature(SECRET, new Headers(), raw(BODY), now)).toBe("unauthorized")
  const malformed = new Headers({ "X-Slack-Signature": "v0=abc", "X-Slack-Request-Timestamp": String(NOW_SECONDS) })
  expect(verifySlackSignature(SECRET, malformed, raw(BODY), now)).toBe("unauthorized")
})

test("a bearer token is not a Slack credential", () => {
  const headers = new Headers({ Authorization: `Bearer ${SECRET}` })
  expect(verifySlackSignature(SECRET, headers, raw(BODY), NOW_SECONDS * 1000)).toBe("unauthorized")
})
