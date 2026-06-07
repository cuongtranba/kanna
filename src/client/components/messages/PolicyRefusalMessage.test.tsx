import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PolicyRefusalMessage } from "./PolicyRefusalMessage"
import type { ProcessedPolicyRefusalMessage } from "./types"

function buildMessage(overrides: Partial<ProcessedPolicyRefusalMessage> = {}): ProcessedPolicyRefusalMessage {
  return {
    kind: "policy_refusal",
    text: "API Error: Claude Code is unable to respond to this request, which appears to violate our Usage Policy.",
    id: "refusal-1",
    timestamp: "2026-06-07T00:00:00Z",
    ...overrides,
  }
}

describe("PolicyRefusalMessage", () => {
  test("labels the card as a Usage Policy block, not a generic API error", () => {
    const html = renderToStaticMarkup(<PolicyRefusalMessage message={buildMessage()} />)
    expect(html).toContain("Blocked by Usage Policy")
  })

  test("strips the misleading 'API Error:' prefix from the body", () => {
    const html = renderToStaticMarkup(<PolicyRefusalMessage message={buildMessage()} />)
    expect(html).toContain("Claude Code is unable to respond")
    expect(html).not.toContain("API Error:")
  })

  test("links to the Usage Policy", () => {
    const html = renderToStaticMarkup(<PolicyRefusalMessage message={buildMessage()} />)
    expect(html).toContain("anthropic.com/legal/aup")
  })

  test("renders request id when provided", () => {
    const html = renderToStaticMarkup(
      <PolicyRefusalMessage message={buildMessage({ requestId: "req_011CboJxt7" })} />
    )
    expect(html).toContain("req_011CboJxt7")
  })

  test("omits request id row when missing", () => {
    const html = renderToStaticMarkup(<PolicyRefusalMessage message={buildMessage()} />)
    expect(html).not.toContain("Request ID")
  })
})
