import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import "../../lib/testing/setupHappyDom"
import type { ProcessedResultMessage } from "./types"
import { ResultMessage } from "./ResultMessage"

const NOOP_RETRY = (_resultMessageId: string): void => {}

function makeMessage(overrides: Partial<ProcessedResultMessage> = {}): ProcessedResultMessage {
  return {
    kind: "result",
    id: "result-1",
    timestamp: new Date().toISOString(),
    success: false,
    cancelled: false,
    result: "",
    durationMs: 0,
    ...overrides,
  } as ProcessedResultMessage
}

describe("ResultMessage", () => {
  test("renders OAuth refusal body with chat-link markdown as a router Link", () => {
    const refusalText =
      "All OAuth tokens are unavailable:\n"
      + "  - personal: in use by [Other Chat](/chat/abcdef12-3456-7890-abcd-ef1234567890)\n"
      + "Close the chat holding a contested token, wait for the rate-limit to reset, or add another token."
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage message={makeMessage({ result: refusalText, durationMs: 0 })} />
      </MemoryRouter>
    )
    expect(html).toContain("Other Chat")
    expect(html).toContain("href=\"/chat/abcdef12-3456-7890-abcd-ef1234567890\"")
    expect(html).toContain("All OAuth tokens are unavailable")
    // durationMs === 0 means refusal never started; hide the "Failed after"
    // footer so the UI doesn't lie with "Failed after 0ms".
    expect(html).not.toContain("Failed after")
  })

  test("shows duration footer when the turn actually ran and errored", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage message={makeMessage({ result: "Boom", durationMs: 1234 })} />
      </MemoryRouter>
    )
    expect(html).toContain("Boom")
    expect(html).toContain("Failed after")
  })

  test("empty error body renders only the duration footer (api_error already shown)", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage message={makeMessage({ result: "", durationMs: 2000 })} />
      </MemoryRouter>
    )
    expect(html).not.toContain("An unknown error occurred")
    expect(html).not.toContain("bg-destructive/10")
    expect(html).toContain("Failed after")
  })

  test("does not crash when result is missing (aborted-stream error entry)", () => {
    // Aborted-stream error results persist with no `result` key (the SDK error
    // frame carries none). The render must not call `.trim()` on undefined.
    const message = makeMessage({ durationMs: 3000 })
    delete (message as { result?: string }).result
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage message={message} />
      </MemoryRouter>
    )
    expect(html).not.toContain("bg-destructive/10")
    expect(html).toContain("Failed after")
  })

  test("renders success result as just a duration footer", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage message={makeMessage({ success: true, result: "", durationMs: 500 })} />
      </MemoryRouter>
    )
    expect(html).not.toContain("bg-destructive")
  })
})

describe("ResultMessage — codex failure reasons", () => {
  test("replaces the provider sentence with the friendly description", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage
          message={makeMessage({
            result: "Selected model is at capacity. Please try a different model.",
            durationMs: 1200,
            codexErrorInfo: "serverOverloaded",
          })}
        />
      </MemoryRouter>
    )
    expect(html).toContain("The selected model is temporarily at capacity.")
    expect(html).not.toContain("Please try a different model.")
  })

  test("keeps the raw sentence when the tag has no wording", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage
          message={makeMessage({
            result: "Something went sideways",
            durationMs: 1200,
            codexErrorInfo: "other",
          })}
        />
      </MemoryRouter>
    )
    expect(html).toContain("Something went sideways")
    expect(html).toContain("bg-destructive/10")
  })

  test("offers Retry on a transient failure", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage
          message={makeMessage({
            result: "Selected model is at capacity.",
            durationMs: 1200,
            codexErrorInfo: "serverOverloaded",
          })}
          onRetry={NOOP_RETRY}
        />
      </MemoryRouter>
    )
    expect(html).toContain(">Retry</button>")
    expect(html).toContain("Failed after")
  })

  test("does not offer Retry on a non-transient failure", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage
          message={makeMessage({
            result: "Context window exceeded",
            durationMs: 1200,
            codexErrorInfo: "contextWindowExceeded",
          })}
          onRetry={NOOP_RETRY}
        />
      </MemoryRouter>
    )
    expect(html).toContain("context window")
    expect(html).not.toContain("</button>")
  })

  test("does not offer Retry when no retry handler is wired", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultMessage
          message={makeMessage({
            result: "Selected model is at capacity.",
            durationMs: 1200,
            codexErrorInfo: "serverOverloaded",
          })}
        />
      </MemoryRouter>
    )
    expect(html).not.toContain("</button>")
  })

  test("clicking Retry re-sends the failed turn's prompt", async () => {
    const onRetry = mock((_resultMessageId: string) => Promise.resolve())
    const container = document.createElement("div")
    document.body.appendChild(container)

    await act(async () => {
      createRoot(container).render(
        <MemoryRouter>
          <ResultMessage
            message={makeMessage({
              id: "result-42",
              result: "Selected model is at capacity.",
              durationMs: 1200,
              codexErrorInfo: "serverOverloaded",
            })}
            onRetry={onRetry}
          />
        </MemoryRouter>,
      )
    })

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    )
    expect(retry).toBeDefined()
    await act(async () => {
      retry!.click()
    })

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0]?.[0]).toBe("result-42")
    container.remove()
  })
})
