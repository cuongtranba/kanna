import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ApiErrorMessage } from "./ApiErrorMessage"
import type { ProcessedApiErrorMessage } from "./types"

function buildMessage(overrides: Partial<ProcessedApiErrorMessage> = {}): ProcessedApiErrorMessage {
  return {
    kind: "api_error",
    status: 529,
    text: "API Error: 529 Overloaded. This is a server-side issue, usually temporary.",
    id: "err-1",
    timestamp: "2026-05-22T00:00:00Z",
    ...overrides,
  }
}

describe("ApiErrorMessage", () => {
  test("renders status badge with code + label", () => {
    const html = renderToStaticMarkup(<ApiErrorMessage message={buildMessage()} />)
    expect(html).toContain("529")
    expect(html).toContain("Overloaded")
  })

  test("renders error text", () => {
    const html = renderToStaticMarkup(<ApiErrorMessage message={buildMessage()} />)
    expect(html).toContain("server-side issue")
  })

  test("renders status link when status is known", () => {
    const html = renderToStaticMarkup(<ApiErrorMessage message={buildMessage()} />)
    expect(html).toContain("status.claude.com")
  })

  test("renders request id when provided", () => {
    const html = renderToStaticMarkup(
      <ApiErrorMessage message={buildMessage({ requestId: "req_xyz" })} />
    )
    expect(html).toContain("req_xyz")
  })

  test("omits request id row when missing", () => {
    const html = renderToStaticMarkup(<ApiErrorMessage message={buildMessage()} />)
    expect(html).not.toContain("Request ID")
  })

  test("falls back to generic label when status is 0", () => {
    const html = renderToStaticMarkup(
      <ApiErrorMessage message={buildMessage({ status: 0, text: "Unknown failure." })} />
    )
    expect(html).toContain("API Error")
    expect(html).not.toContain("status.claude.com")
  })

  test("labels 429 as Rate Limited", () => {
    const html = renderToStaticMarkup(
      <ApiErrorMessage message={buildMessage({ status: 429, text: "API Error: 429" })} />
    )
    expect(html).toContain("Rate Limited")
    expect(html).toContain("status.claude.com")
  })

  const VERSION_TOO_OLD_TEXT = "API Error: 400 Claude Code 2.1.272 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again."

  test("400 with claude_code_version_too_old explains the version mismatch and gives a remedy for bundled and own binaries", () => {
    const html = renderToStaticMarkup(
      <ApiErrorMessage
        message={buildMessage({ status: 400, text: VERSION_TOO_OLD_TEXT, apiErrorReason: "claude_code_version_too_old" })}
      />
    )
    expect(html).toContain("Model not supported by this Claude Code version")
    expect(html).toContain("Pick another model, or update Kanna")
    expect(html).toContain("claude update")
    expect(html).toContain("does not support this model")
    expect(html).not.toContain("400 API Error")
    expect(html).not.toContain("status.claude.com")
    expect(html).not.toContain("Check status")
  })

  test("400 with no reason renders the raw text and no status link", () => {
    const html = renderToStaticMarkup(
      <ApiErrorMessage message={buildMessage({ status: 400, text: VERSION_TOO_OLD_TEXT })} />
    )
    expect(html).toContain("400 API Error")
    expect(html).toContain("does not support this model")
    expect(html).not.toContain("Model not supported by this Claude Code version")
    expect(html).not.toContain("Check status")
  })

  test("an unknown reason renders like a reasonless error", () => {
    const withUnknown = renderToStaticMarkup(
      <ApiErrorMessage message={buildMessage({ apiErrorReason: "some_future_reason" })} />
    )
    expect(withUnknown).toBe(renderToStaticMarkup(<ApiErrorMessage message={buildMessage()} />))
  })

  test("529 still links the status page", () => {
    const html = renderToStaticMarkup(<ApiErrorMessage message={buildMessage({ status: 529 })} />)
    expect(html).toContain("Check status")
  })
})
