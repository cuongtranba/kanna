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
  })
})
